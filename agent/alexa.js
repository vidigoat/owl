/**
 * The simulated Alexa+ — a model that decides, over MCP, what to do next.
 *
 * ── What changed, and why it matters to the track ───────────────────────────
 *
 * Until this file, the "assistant" on the device was a script: the front end called /api/verify,
 * then /api/guide, then /api/part, in the order its author wrote down. Every screen was driven by
 * real tools, and none of it was an agent — nothing DECIDED anything. The Alexa+ track's own bar for
 * a creative entry is an agentic workflow that orchestrates services by itself, and a fixed call
 * sequence is the definition of the other kind.
 *
 * So this is the orchestrator: an Amazon Nova model on Bedrock, given the MCP server's tools and a
 * conversation, choosing which tool to call, reading what comes back, and deciding whether to call
 * another or to speak. It reaches the tools over MCP at a URL — see agent/mcp-client.js — so what it
 * exercises is exactly what a real Alexa+ connector would.
 *
 * ── Two things the model is deliberately NOT trusted with ───────────────────
 *
 *   STATE      The hypothesis space, the checks already done, the causes already ruled out, the
 *              photo the person just held up. A model asked to copy a JSON array out of one tool
 *              result into the next call, perfectly, every turn, will eventually drop an element —
 *              and a dropped element is a ruled-out cause quietly coming back to life. The client
 *              keeps that state and threads it into the calls that need it, the way any assistant
 *              host keeps a conversation's working memory. Everything it fills in is recorded in the
 *              step trace, so nothing is done on the model's behalf invisibly.
 *
 *   MONEY      It may ASK to open a cart. It cannot open one. `begin_checkout` refuses anything the
 *              gate did not uphold, whatever the caller claims — `mcp/tools/gate-adversarial.test.js`
 *              is thirty-two attempts to talk it round, none of which worked. The agent adds no
 *              permission the tools do not already enforce, which is the only safe way to put a
 *              model in front of a payment.
 */

const { McpClient } = require('./mcp-client');
const { converse: bedrockConverse, DEFAULT_MODEL } = require('./bedrock');

const MAX_TOOL_ROUNDS = 8;

const SYSTEM = `You are Alexa+, on an Echo Show in someone's home. Their hands are on a broken appliance. You supply the diagnosis, the memory and the patience; they supply the hands.

Every fact comes from a tool. Never state what a fault code means, what caused it, a repair step, a part, a price, how long something takes, or what equipment it needs unless a tool returned it in this conversation. Do not fill gaps with what is usually true — if a tool did not say it, you do not know it. If a tool refuses or abstains, say so plainly, in their terms, and do not look for a way around it.

Getting started: you need the model and the fault. Take them from what the person says, or call see with usePhoto true when they have shown you the panel. Many machines print no fault code — then use describe_problem with the model and what they said. If it returns several matches, read the manual's wording of each back and ask which one it is; if one, use it. A match's id stands where a fault code would: pass it as code to hypotheses and everything after.

If hypotheses comes back with sayFirst, begin what you say with it, in your own words — the fault has come back after a repair this household recorded. Then carry on as normal.

Narrowing a fault code: ALWAYS call hypotheses first, then next_test — even when one cause looks likely, because the cheapest check often settles it in seconds. Ask the person to do that ONE check, in one short sentence, and STOP. Wait for them. Never ask two things at once, and never answer for them. When they answer, call observe with that check's testId and the outcome value that matches what they said, then next_test again. Repeat until one cause is left.

If next_test says the manual documents no check, do not invent one: call verify_diagnosis with the first cause in its order.

Only when one cause is left, call verify_diagnosis with its causeId. If it abstains, tell them what is still uncertain.

If it is upheld: offer to talk them through it with guide. Guiding is one step per turn: say the next step, then stop and wait for them to say it is done. Say a step as guide gives it; when it points to a page of the manual, tell them the page and do not describe the procedure yourself. Only if they want the part, call begin_checkout, read out the itemised total and ask for a clear yes. Only after a clear yes, call confirm_checkout.

Never walk anyone through work behind mains wiring — say it needs a technician.

An ordered part is not a repair. Call remember_repair only once they tell you the work is done, recording exactly what was done — and confirmed only if confirm_fix saw the fault clear. When they tell you it works, say it is noted as they reported it; do not say the fault is cleared, because you did not see it. If remember_repair says it was not kept, say exactly that — never that it is saved for next time. Use repair_history and whats_due when they ask about the past or what needs attention.

When they ask whether a machine is worth repairing again, or whether to replace it, call replace_or_repair with the model and the fault before anything else — do not start a diagnosis. Say what it knows from this house's record, and name the figure it says it cannot have; never give a verdict it did not give.

You speak ONLY by calling speak — nothing else you write reaches the person. End every turn with exactly one speak call: one or two short sentences, as you would say them across a room. No lists, no ids, no numbers they did not need.`;

/**
 * Speaking is a tool call, not free text.
 *
 * The first live run put Nova 2 Lite's entire chain of thought into the text it returned — "Okay,
 * let's see. The user has a Bosch dishwasher…" — every word of which a speaker would have read
 * aloud across a kitchen. Asking a model nicely not to think out loud is a prompt; making every
 * response a tool call (`toolChoice: any`) and making `speak` the only way to reach the person is a
 * structure. Whatever else it writes goes to the trace, never to the room.
 */
const SPEAK = {
  toolSpec: {
    name: 'speak',
    description:
      'Say something to the person. This is the ONLY way to talk to them, and every turn must end with it. One or two short sentences, spoken across a room.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Exactly what to say out loud.' },
          waitingFor: { type: 'string', enum: ['their answer', 'nothing'], description: 'Whether you are now waiting for them to do or say something.' },
        },
        required: ['text'],
      },
    },
  },
};

/**
 * The tools this agent is given — the ones its job needs, not every one the server has.
 *
 * `diagnose` is left out on purpose. It ranks causes and stops, and on the first live run the model
 * took it as a shortcut: diagnose, verify the likeliest, start the repair — skipping the five-second
 * listening check that `next_test` exists to find, which is the most useful thing this product does.
 * `hypotheses` returns the same causes AND the checks that narrow them, so nothing is lost but the
 * shortcut. `read_manual` is left out because learning a machine is the review bench's job, with a
 * person admitting what it read, not a conversation's.
 */
const AGENT_TOOLS = new Set([
  'see', 'read_error', 'identify_appliance', 'describe_problem',
  'hypotheses', 'next_test', 'observe', 'verify_diagnosis',
  'guide', 'find_part', 'begin_checkout', 'confirm_checkout',
  'confirm_fix', 'remember_repair', 'repair_history', 'whats_due', 'replace_or_repair',
]);

/** Tools that take a photograph. The model decides WHETHER to look; the client supplies the bytes. */
const PHOTO_TOOLS = new Set(['see', 'read_error', 'identify_appliance', 'confirm_fix', 'read_manual']);

/**
 * An MCP tool, as Bedrock expects it — with the image arguments replaced by one boolean.
 *
 * A remote model should never be handed a server file path to fill in (that was a hole: see
 * mcp/tools/local-file.js), and cannot sensibly produce base64. It says `usePhoto: true` and the
 * client attaches the photo the person actually showed.
 */
function toBedrockTool(t) {
  const schema = JSON.parse(JSON.stringify(t.inputSchema || { type: 'object', properties: {} }));
  schema.type = 'object';
  schema.properties = schema.properties || {};
  if (PHOTO_TOOLS.has(t.name)) {
    delete schema.properties.imagePath;
    delete schema.properties.imageBase64;
    schema.properties.usePhoto = { type: 'boolean', description: 'true to look at the photo the person just showed you' };
    if (Array.isArray(schema.required)) schema.required = schema.required.filter((r) => r !== 'imagePath' && r !== 'imageBase64');
  }
  return {
    toolSpec: {
      name: t.name,
      description: String(t.description || t.name).slice(0, 600),
      inputSchema: { json: schema },
    },
  };
}

/** What the person hears: the model's words, without the reasoning some models wrap around them. */
const spoken = (blocks = []) =>
  blocks
    .filter((b) => typeof b.text === 'string')
    .map((b) => b.text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();

class Alexa {
  /**
   * @param {object} opts
   * @param {string} opts.url            the MCP server — e.g. https://owl-repair.vercel.app/mcp
   * @param {string} [opts.model]        a Bedrock model id
   * @param {Function} [opts.converse]   injected in tests; defaults to agent/bedrock.js
   * @param {object} [opts.client]       an McpClient; built from `url` if absent
   */
  constructor({ url, model = DEFAULT_MODEL, converse = bedrockConverse, client, converseOpts = {} } = {}) {
    this.client = client || new McpClient(url);
    this.model = model;
    this.converse = converse;
    this.converseOpts = converseOpts;
    this.messages = [];
    this.memory = { photo: null, model: null, code: null, space: null, tests: null, performed: [], ruledOut: [], fixSeen: false, checkout: null };
    this.turnNo = 0;
    this.cost = 0;
    this.tokens = { in: 0, out: 0 };
    this.tools = [];
  }

  async connect() {
    if (this.tools.length) return this;
    await this.client.connect();
    this.tools = [...this.client.tools.filter((t) => AGENT_TOOLS.has(t.name)).map(toBedrockTool), SPEAK];
    return this;
  }

  /**
   * Fill in what the client knows and the model should not have to carry.
   *
   * @returns {{ args, filled: string[] }} — `filled` names every argument the client supplied, so the
   *   step trace shows it rather than hiding it.
   */
  prepare(name, input) {
    const args = { ...(input || {}) };
    const m = this.memory;
    const filled = [];

    /*
     * A model number is a fact about the room, and the agent does not get to supply one.
     *
     * Told only "My dishwasher says E24", a live run called hypotheses with model "Whirlpool
     * WDT750SAHZ" — a machine nobody mentioned — and then told the person it had no service data
     * for their Whirlpool. A model number is allowed through only if the person said it or a tool
     * read it (the camera, the household's record). Otherwise it is withheld, the tool answers
     * "which model?", and that is the question the person hears.
     */
    if (typeof args.model === 'string' && args.model && !this.grounded(args.model)) {
      delete args.model;
      filled.push('model withheld (nobody said it and no tool read it)');
    }
    const fill = (key, value) => {
      if ((args[key] === undefined || args[key] === null || args[key] === '') && value != null) {
        args[key] = value;
        filled.push(key);
      }
    };

    if (PHOTO_TOOLS.has(name)) {
      const wants = args.usePhoto !== false;
      delete args.usePhoto;
      if (wants && m.photo) {
        args.imageBase64 = m.photo;
        filled.push('imageBase64 (the photo they showed)');
      }
    }
    if (['hypotheses', 'next_test', 'observe', 'verify_diagnosis', 'guide', 'find_part', 'begin_checkout', 'replace_or_repair', 'repair_history', 'describe_problem'].includes(name)) {
      fill('model', m.model);
    }
    if (['hypotheses', 'next_test', 'observe', 'verify_diagnosis', 'guide', 'begin_checkout', 'replace_or_repair'].includes(name)) {
      fill('code', m.code);
    }
    if (name === 'next_test') {
      fill('space', m.space);
      fill('tests', m.tests);
      if (!Array.isArray(args.performed) || !args.performed.length) {
        if (m.performed.length) {
          args.performed = [...m.performed];
          filled.push('performed');
        }
      }
    }
    if (name === 'confirm_checkout') fill('sessionId', m.checkout?.sessionId);
    if (name === 'observe') {
      fill('space', m.space);
      fill('tests', m.tests);
    }
    /*
     * A repair is not confirmed because the model says so.
     *
     * On a live run the model ordered a drain pump and in the same breath wrote the house's memory
     * as "Replaced the pump · confirmed: true" — a part that had not arrived, fitted by nobody,
     * recorded as a verified fix. If E24 came back next month, that record would say a new pump
     * failed, which is precisely the confident wrong answer this product exists to prevent.
     *
     * `confirmed` may be true only if `confirm_fix` actually saw the fault clear in this conversation.
     * The model can say what it likes; the record says what happened.
     */
    if (name === 'remember_repair' && args.confirmed === true && !m.fixSeen) {
      args.confirmed = false;
      filled.push('confirmed=false (nothing in this conversation saw the fix work)');
    }
    if (name === 'verify_diagnosis' || name === 'begin_checkout') {
      if ((!Array.isArray(args.ruledOut) || !args.ruledOut.length) && m.ruledOut.length) {
        args.ruledOut = [...m.ruledOut];
        filled.push('ruledOut');
      }
    }
    return { args, filled };
  }

  /*
   * A repair that needs a part is not guided before anybody has asked about the part.
   *
   * A live run heard "it's completely silent", upheld the pump, and in the same breath began "switch
   * the machine off at the wall… lift off the white pump cover" — walking somebody through fitting a
   * pump they do not have. So the first guide call for a cause that needs a part is answered here:
   * say what the part is, and ask whether to order it or whether they already have one. The call
   * after that goes through — by then the person has been asked, and whatever they said is theirs.
   */
  partFirst(args) {
    const m = this.memory;
    if (!m.partNeeded || m.ordered) return null;
    if (args.causeId && m.partNeeded !== true && m.partNeeded !== args.causeId) return null;
    // Asked on an EARLIER turn: the person has had the chance to answer. Refused-then-retried in
    // the same turn is the model answering for them.
    if (m.partAskedTurn && this.turnNo > m.partAskedTurn) return null;
    m.partAskedTurn = m.partAskedTurn || this.turnNo;
    return 'This repair needs a part they may not have yet. Before guiding, tell them what the part is and ask whether to order it — or whether they already have one. Nothing was guided.';
  }

  /*
   * Money moves only on a yes to a total they HEARD.
   *
   * A live eval run quoted the bare part price off find_part — "£38.42", in a currency no tool had
   * named — asked "would you like me to order it?", and on "Yes, order it" opened the checkout and
   * confirmed it in the same breath. The person agreed to one figure and was charged $41.78, a total
   * nobody had said. The server cannot see turns; the voice layer can, so it holds the rule:
   *
   *   the checkout must have been opened in an EARLIER turn,
   *   and the speech that ended that turn must have contained its total.
   *
   * Otherwise the confirm is refused here, in words the model can act on, and nothing is charged.
   */
  unheardCheckout(args) {
    const c = this.memory.checkout;
    if (!c || (args.sessionId && args.sessionId !== c.sessionId)) {
      return 'No checkout has been read out to them. Call begin_checkout, read out its total, and wait for their yes.';
    }
    if (c.turn === this.turnNo) {
      return `They have not heard the total yet. Read out the checkout — $${c.total} in total — and wait for their yes. Nothing was charged.`;
    }
    if (!c.heard) {
      return `The total ($${c.total}) was never said to them. Read it out and wait for their yes. Nothing was charged.`;
    }
    return null;
  }

  /*
   * The tools that look are offered only when there is something to look at.
   *
   * With them always on the list, a person who SAID "SHE3AR75UC, E09" was asked to hold the panel up
   * to the camera — the model reached for `see` first, was told nothing had been shown, and did
   * what that answer suggested instead of what the person had already said. A rule in the prompt
   * would be one more request. Not offering a tool with no photo to point it at is a structure.
   */
  offered() {
    if (this.memory.photo) return this.tools;
    return this.tools.filter((t) => !PHOTO_TOOLS.has(t.toolSpec.name));
  }

  /** Did the person say this model number, or did a tool read it? */
  grounded(model) {
    const m = this.memory;
    const squash = (t) => String(t).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const heard = squash(m.heard || '');
    const known = new Set((m.models || []).map(squash));
    if (known.has(squash(model))) return true;
    // "Bosch SHE3AR75UC" is grounded by its model-shaped part: a token with a digit in it, four
    // characters or more. A brand name alone grounds nothing.
    const parts = String(model).toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 4 && /\d/.test(t));
    return parts.length > 0 && parts.every((t) => heard.includes(t) || known.has(t));
  }

  /** Learn from what a tool returned: the state the next call will need. */
  absorb(name, args, value) {
    const m = this.memory;
    if (!value || typeof value !== 'object') return;
    // Every model number a tool has returned — the camera's reading, the household's machines —
    // is one the agent may use from here on.
    try {
      const seen = JSON.stringify(value).match(/"model":"([^"]{2,40})"/g) || [];
      if (seen.length) m.models = [...new Set([...(m.models || []), ...seen.map((x) => x.slice(9, -1))])].slice(-40);
    } catch { /* a result that cannot be serialised grounds nothing */ }
    if (args.model) m.model = args.model;
    if (args.code) m.code = args.code;
    if (name === 'see' || name === 'read_error' || name === 'identify_appliance') {
      if (value.model) m.model = value.model;
      if (value.code) m.code = value.code;
    }
    if (name === 'confirm_fix' && value.confirmed === true) m.fixSeen = true;
    if (name === 'verify_diagnosis' && value.upheld && value.maySpend) m.partNeeded = value.cause?.id || args.causeId || true;
    if (name === 'confirm_checkout' && value.ok) m.ordered = true;
    if (name === 'begin_checkout' && value.ok && value.sessionId) {
      m.checkout = { sessionId: value.sessionId, total: value.totals?.total, turn: this.turnNo, heard: false };
    }
    if (name === 'next_test') m.needsNextTest = false;
    if (name === 'hypotheses' && Array.isArray(value.space)) {
      m.needsNextTest = true;
      m.space = value.space;
      m.tests = value.tests || [];
      m.performed = [];
      m.ruledOut = [];
    }
    if (name === 'observe' && Array.isArray(value.space) && !value.error) {
      m.needsNextTest = true;
      m.space = value.space;
      if (args.testId) m.performed.push(args.testId);
      else if (args.outcome?.test) m.performed.push(args.outcome.test);
      for (const c of value.eliminated || []) {
        const id = typeof c === 'string' ? c : c.id;
        if (id && !m.ruledOut.includes(id)) m.ruledOut.push(id);
      }
    }
  }

  /**
   * One thing the person said — and, if they held one up, a photo.
   *
   * @returns {{ say: string, steps: object[], cost: number, rounds: number }}
   */
  async turn(text, { photo } = {}) {
    await this.connect();
    this.turnNo++;
    if (photo) this.memory.photo = photo;

    // What the person has said, kept so a model number can be checked against it (see prepare).
    this.memory.heard = `${this.memory.heard || ''} ${String(text || '').slice(0, 2000)}`.slice(-8000);
    const content = [{ text: String(text || '').slice(0, 2000) }];
    if (photo) content.push({ text: '(They are holding the appliance panel up to the camera.)' });
    this.messages.push({ role: 'user', content });

    const steps = [];
    let say = '';
    let tooLong = 0;
    let askedWithoutNext = false;
    let claimedFixedOnce = false;
    let rounds = 0;
    let cost = 0;

    for (; rounds < MAX_TOOL_ROUNDS; rounds++) {
      const r = await this.converse(
        { messages: this.messages, system: SYSTEM, tools: this.offered(), toolChoice: { any: {} }, model: this.model },
        this.converseOpts
      );
      cost += r.cost || 0;
      this.tokens.in += r.usage?.inputTokens || 0;
      this.tokens.out += r.usage?.outputTokens || 0;
      const message = r.message || { role: 'assistant', content: [] };
      this.messages.push(message);

      const uses = (message.content || []).filter((b) => b.toolUse);
      const thought = spoken(message.content);
      if (thought) steps.push({ tool: '(thinking)', asked: {}, filled: [], answer: thought.slice(0, 240), isError: false, private: true });
      if (!uses.length) {
        // `toolChoice: any` should make this impossible. If a model manages it anyway, its text is a
        // thought, not speech — so the person hears a plain request to go again, not the reasoning.
        say = 'Sorry — say that again?';
        break;
      }

      const results = [];
      let spokeNow = null;
      for (const b of uses) {
        const { toolUseId, name, input } = b.toolUse;
        if (name === 'speak') {
          const text = String(input?.text || '').trim();
          /*
           * Too long to say across a room, sent back once.
           *
           * "One or two short sentences" is in the prompt and in this tool's description, and the eval
           * still measured 73-word turns: four guide steps read out as one, to somebody with both hands
           * in a machine who will remember the first. A limit a model is asked to respect is a request;
           * refusing the line is a structure. Once only — a second long line is said rather than
           * leaving the person in silence, and the eval counts it.
           */
          /*
           * A question only after next_test chose it.
           *
           * The checks are kept from the model so it has to ask next_test — and a live eval run
           * simply made one up instead: "the filter check costs nothing and is often the cause. Is
           * the filter clogged?" Plausible, and not the check that rules out the most. So while a
           * diagnosis is open (several causes, checks available) and next_test has not been asked
           * since the space last changed, a line that asks something is sent back once.
           */
          const m = this.memory;
          const open = Array.isArray(m.space) && m.space.length > 1 && Array.isArray(m.tests) && m.tests.length > 0;
          if (open && m.needsNextTest && /\?/.test(text) && !askedWithoutNext) {
            askedWithoutNext = true;
            steps.push({ tool: 'speak', asked: { text: text.slice(0, 80) }, filled: [], answer: 'refused: a question before next_test chose it', isError: true, private: true });
            results.push({ toolResult: { toolUseId, content: [{ text: 'Not said. Call next_test first — it chooses which check to ask — then ask that one.' }], status: 'error' } });
            continue;
          }
          /*
           * Not said to be fixed when nothing saw it fixed.
           *
           * The record already says so — remember_repair is downgraded to confirmed: false — and a
           * live recording then had the agent say "noted as you reported it — the fault is cleared"
           * over the top of it. The record and the voice have to agree.
           */
          const unseen = steps.some((x) => x.tool === 'remember_repair' && /as reported, not seen/.test(x.answer));
          // Any subject, and the outcome in the person's own words too: a live run recorded a fix
          // as "not seen to clear" and then said "The filter was cleared and the machine drains now."
          if (unseen && !claimedFixedOnce && SAYS_IT_WORKED.test(text)) {
            claimedFixedOnce = true;
            steps.push({ tool: 'speak', asked: { text: text.slice(0, 80) }, filled: [], answer: 'refused: said fixed, recorded as not seen to clear', isError: true, private: true });
            results.push({ toolResult: { toolUseId, content: [{ text: 'Not said. Nothing in this conversation saw the fault clear, so do not say it is cleared or fixed. Say it is noted as they reported it.' }], status: 'error' } });
            continue;
          }
          const long = wordCount(text) > MAX_SPOKEN_WORDS || sentenceCount(text) > 3;
          if (long && tooLong < 2) {
            // Sent back twice at most: a live run was refused once and came back with four sentences again.
            tooLong++;
            steps.push({ tool: 'speak', asked: { text: text.slice(0, 80) }, filled: [], answer: `refused: ${wordCount(text)} words — too long to say across a room`, isError: true, private: true });
            results.push({ toolResult: { toolUseId, content: [{ text: `Not said: ${wordCount(text)} words is too long to hear across a room. Say ONE thing in under ${MAX_SPOKEN_WORDS} words — if you are guiding, just the next step — and wait.` }], status: 'error' } });
            continue;
          }
          spokeNow = { text, waitingFor: input?.waitingFor || 'nothing' };
          results.push({ toolResult: { toolUseId, content: [{ text: 'said' }], status: 'success' } });
          continue;
        }
        const { args, filled } = this.prepare(name, input);
        let value;
        let isError = false;
        /*
         * Asked to look, with nothing to look at.
         *
         * A live run called `see` and then `identify_appliance` with no photo in the conversation, and
         * the server answered "No image at undefined" — twice, about an argument the model never
         * sent. The client is the one that knows whether anything was shown, so it answers.
         */
        const blind = PHOTO_TOOLS.has(name) && !args.imageBase64 && !args.imagePath;
        const unheard = name === 'confirm_checkout' ? this.unheardCheckout(args) : null;
        const partFirst = name === 'guide' ? this.partFirst(args) : null;
        /*
         * No machine has been named, and the model tried to supply one.
         *
         * Withholding the invented model and sending the call on was not enough: the server answered
         * "hypotheses needs model.", and a live run asked again with "Dishwasher" seven times. The
         * client knows why there is no model, so it answers, with the one thing to do next.
         */
        const unnamed = filled.some((f) => f.startsWith('model withheld')) && !args.model && NEEDS_MODEL.has(name);
        if (unnamed) {
          value = {
            known: false,
            refused: true,
            reason: 'Nobody has said which machine this is, and a model number cannot be guessed — a brand or "dishwasher" is not one. Do not call this again. Ask them for the model number, which is on the rating plate inside the door, or to hold the plate up to the camera.',
            answeredBy: 'client',
          };
        } else if (partFirst) {
          value = { known: false, refused: true, reason: partFirst, answeredBy: 'client' };
        } else if (unheard) {
          value = { ok: false, refused: true, reason: unheard, answeredBy: 'client' };
        } else if (blind) {
          value = {
            abstain: true,
            reason: 'Nothing has been shown to the camera in this conversation. If they told you the model and code, use those; if not, ask them to read them out or hold the panel up.',
            answeredBy: 'client',
          };
        } else try {
          ({ value, isError } = await this.client.call(name, args));
        } catch (e) {
          value = { error: e.message };
          isError = true;
        }
        this.absorb(name, args, value);
        // `result` is for a screen to draw from (the MCP App card); the model is shown forModel().
        steps.push({ tool: name, asked: redact(input), filled, answer: summarise(name, value), isError, result: value });

        /*
         * The household is consulted, not merely kept.
         *
         * remember_repair has always written what was done, and repair_history could read it back —
         * but only if the model thought to ask, and nothing prompted it to: told "my SHE3AR75UC is
         * showing E24 again", it would start the diagnosis from scratch weeks after the pump was
         * replaced. The most useful sentence this product can say on a second visit — "this came
         * back after the pump was replaced on the 2nd" — hung on a tool call nobody asked for. So
         * when a diagnosis starts on a machine, the client reads that machine's record and hands it
         * over with the causes. The call is in the trace like any other.
         */
        if (name === 'hypotheses' && !isError && value && value.known && args.model) {
          let past = null;
          try {
            ({ value: past } = await this.client.call('repair_history', { model: args.model }));
          } catch { /* no record is not a reason to stop a diagnosis */ }
          const receipts = Array.isArray(past?.receipts) ? past.receipts.slice(-5) : [];
          if (receipts.length) {
            value = { ...value, thisHouse: receipts.map((r) => ({ when: String(r.at).slice(0, 10), code: r.code, cause: r.cause, done: r.action, confirmedFixed: r.confirmed === true })) };
            // The same fault, fixed before: a sentence, built from the record, not left to be noticed.
            // A live eval run was handed the record and never mentioned it.
            const same = [...receipts].reverse().find((r) => r.code && r.code === args.code);
            if (same) {
              // The date the record carries, not this machine's clock: 2026-09-02T18:30Z is "September 2".
              const when = new Date(same.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
              const done = String(same.action || 'a repair').replace(/[.\s]+$/, '');
              // One sentence: it is said ahead of the model's own line, which has two of its own.
              value.sayFirst = `This ${args.code} is back — last time, on ${when}: ${done.charAt(0).toLowerCase()}${done.slice(1)}.`;
              this.memory.sayFirst = value.sayFirst;
            }
            steps.push({ tool: 'repair_history', asked: { model: args.model }, filled: ['called by the client when the diagnosis began'], answer: `${receipts.length} earlier repair${receipts.length === 1 ? '' : 's'} on this machine`, isError: false });
          }
        }
        results.push({
          toolResult: {
            toolUseId,
            content: [forModel(name, value)],
            status: isError ? 'error' : 'success',
          },
        });
      }
      this.messages.push({ role: 'user', content: results });
      if (spokeNow) {
        // A checkout counts as read out only if its total was actually in what they heard.
        const c = this.memory.checkout;
        if (c && c.turn === this.turnNo && spokenTotal(spokeNow.text, c.total)) c.heard = true;
        say = spokeNow.text;
        this.waitingFor = spokeNow.waitingFor;
        break;
      }
    }

    /*
     * A fault that has come back is said, whatever the model chose to say.
     *
     * Handed the household's record — and then a ready sentence built from it — Nova still opened
     * with the pump check twice out of two, as though the machine were new to this house. What was
     * done before is the one thing a second visit knows that a first cannot, so the client says it:
     * one sentence, from the record, ahead of the model's line, once.
     */
    if (this.memory.sayFirst && say) {
      if (!/\b(is back|came back|again|last time|before)\b/i.test(say)) say = `${this.memory.sayFirst} ${say}`;
      this.memory.sayFirst = null;
    }

    if (rounds >= MAX_TOOL_ROUNDS && !say) {
      say = 'I have gone round in circles on that one. Tell me again what the machine is doing?';
    }
    this.cost += cost;
    return { say, waitingFor: this.waitingFor || 'nothing', steps, cost, rounds: rounds + 1 };
  }
}

/**
 * What the model is shown of a tool's answer.
 *
 * Everything — except the checks `hypotheses` returns. On a live run the model read its first
 * question straight off that array instead of calling `next_test`, and asked the right one only
 * because it happened to be listed first. Which check to ask is the decision `next_test` exists to
 * make — expected information gain over the effort a person spends — and a model picking from a list
 * by position is not making it. So the client keeps the checks and threads them into `next_test`,
 * and the model, which cannot see them, has to ask.
 */
function forModel(name, value) {
  let v = value;
  // An estimated pace is for the device to wait by, not a fact to say — see guide.js.
  if (name === 'guide' && v && Array.isArray(v.steps) && v.steps.some((s) => s.paceEstimated)) {
    const { totalSeconds, ...rest } = v;
    v = { ...rest, steps: v.steps.map(({ pace, paceEstimated, ...s }) => (paceEstimated ? s : { pace, ...s })) };
  }
  if (name === 'hypotheses' && v && typeof v === 'object' && Array.isArray(v.tests)) {
    const { tests, ...rest } = v;
    v = { ...rest, checks: `${tests.length} available — call next_test to choose which one to ask` };
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? { json: v } : { text: JSON.stringify(v) };
}

// A line that states the repair worked — "is fixed", "was cleared", "drains now" — as distinct from
// one that says it was noted as reported.
const SAYS_IT_WORKED = /\b(is|was|has been|are|were)\s+(now\s+)?(cleared|fixed|resolved|gone|sorted|repaired)\b|\b(drains?|works?|working|runs?|running)\s+(fine\s+|again\s+|properly\s+|well\s+)?now\b|\bnow\s+(drains?|works?|runs?)\b/i;

// Tools that cannot answer without knowing which machine it is.
const NEEDS_MODEL = new Set(['hypotheses', 'describe_problem', 'verify_diagnosis', 'guide', 'find_part', 'begin_checkout', 'replace_or_repair']);
const MAX_SPOKEN_WORDS = 40;
const wordCount = (t) => String(t).split(/\s+/).filter(Boolean).length;
const sentenceCount = (t) => String(t).split(/(?<=[.!?])\s+/).filter(Boolean).length;

/** Whether a spoken line contains a total: "41.78", "$41.78", "41 dollars 78". */
function spokenTotal(text, total) {
  if (typeof total !== 'number') return false;
  const t = String(text);
  if (t.includes(total.toFixed(2)) || t.includes(String(total))) return true;
  const [d, c] = total.toFixed(2).split('.');
  return new RegExp(`\\b${d}\\b[^0-9]{1,20}\\b${c}\\b`).test(t);
}

/** A step, as a person reading the trace would want it — not the whole payload. */
function summarise(name, v) {
  if (!v || typeof v !== 'object') return String(v).slice(0, 160);
  if (v.error) return `error: ${v.error}`;
  // Whatever the tool, a call the client answered itself says so first.
  if (v.answeredBy === 'client') return `held by the client: ${v.reason || ''}`.slice(0, 160);
  if (name === 'hypotheses') return `${(v.space || []).length} possible causes, ${(v.bits ?? 0).toFixed(2)} bits of uncertainty`;
  if (name === 'next_test') {
    if (v.test) return `ask: ${v.test.question}`;
    if (v.noChecks) return `no check documented — the manual's order: ${(v.order || []).map((c) => c.label).join(' · ')}`.slice(0, 160);
    return v.reason || 'nothing left to ask';
  }
  if (name === 'observe') return `left: ${(v.space || []).map((c) => c.label).join(' · ')}`;
  if (name === 'verify_diagnosis') return v.upheld ? `UPHELD${v.maySpend ? ' · may spend' : ''}` : `abstains: ${v.reason || ''}`.slice(0, 160);
  if (name === 'begin_checkout') {
    return v.ok === false || v.opened === false || v.refused
      ? `refused: ${v.reason || ''}`.slice(0, 160)
      : `cart opened: ${v.totals?.total ?? v.totals?.grandTotal ?? JSON.stringify(v.totals || {}).slice(0, 60)}`;
  }
  if (name === 'describe_problem') return v.known ? `"${v.matches?.[0]?.symptom}"` : `not in the manual: ${v.reason || ''}`.slice(0, 160);
  // A refusal is not "no procedure on record": mains work is refused by guide itself.
  if (name === 'guide' && v.refused) return `refused: ${v.reason || ''}`.slice(0, 160);
  if (name === 'guide') return v.known ? `${v.steps.length} steps${v.procedures ? `, from the manual's "${v.procedures[0].heading}"` : ''} · first: ${v.steps[0]?.say || ''}`.slice(0, 160) : `no procedure: ${v.reason || ''}`.slice(0, 160);
  if (name === 'find_part') return v.found ? `${v.part.name} $${v.part.price} · ${v.part.eta} · fits ${v.part.fitsModel}` : `no part: ${v.reason || ''}`.slice(0, 160);
  if (name === 'confirm_checkout') return v.ok ? `ordered ${v.order.part} · $${v.order.total} · ${v.order.orderId}` : `not ordered: ${v.reason || ''}`;
  if (name === 'remember_repair') {
    const what = `${v.entry?.action}${v.entry?.confirmed ? ' (confirmed)' : ' (as reported, not seen to clear)'}`;
    if (v.saved) return `recorded: ${what}`;
    if (v.kept === 'session') return `noted, but not kept — this server has nowhere to keep it: ${what}`.slice(0, 160);
    return `not recorded: ${v.reason || v.error || ''}`.slice(0, 160);
  }
  if (name === 'repair_history') return `${(v.receipts || []).length} earlier repair${(v.receipts || []).length === 1 ? '' : 's'}`;
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/** Arguments as the model sent them, without anything bulky. */
function redact(input) {
  const out = { ...(input || {}) };
  for (const k of ['space', 'tests', 'imageBase64']) if (k in out) out[k] = `<${k}>`;
  return out;
}

module.exports = { Alexa, SYSTEM, SPEAK, AGENT_TOOLS, toBedrockTool, spoken, PHOTO_TOOLS, summariseForTest: summarise };
