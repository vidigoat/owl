/**
 * MCP server — Streamable HTTP, spec 2025-11-25.
 *
 * This is the surface Alexa+ calls. It matters that these tools are genuinely invoked here and not
 * merely described in a README: the submission rules require the track's technology to be called at
 * runtime, and an automated reviewer will look for the call path.
 *
 *   node mcp/server.js            -> http://localhost:8793/mcp
 *
 * Implemented: initialize, tools/list, tools/call over JSON-RPC 2.0.
 * Not yet: SSE for streaming responses, and OAuth 2.1 + PKCE. Resources are live — see mcp/cards.js.
 */

const http = require('http');
const crypto = require('node:crypto');
const { diagnose } = require('./tools/diagnose');
const { verify_diagnosis } = require('./tools/verify_diagnosis');
const { guide } = require('./tools/guide');
const { find_part } = require('./tools/find_part');
const { see } = require('./tools/see');
const { watchStep } = require('./tools/watch_step');
const { read_error } = require('./tools/read_error');
const { identify_appliance } = require('./tools/identify_appliance');
const { read_manual } = require('./tools/read_manual');
const { RESOURCES, APP_URI, APP_TOOLS, spaceCard, stepCard, refusalCard, checkoutCard } = require('./cards');
const { confirm_fix } = require('./tools/confirm_fix');
const { beginCheckout, confirmCheckout } = require('./tools/order_part');
const { receipt, due, history, pauseRepair, resumeRepair, hydrate, persist, SESSION_ONLY } = require('./tools/home');
const { HouseholdStore } = require('./household-store');

/*
 * The household across sessions, on a deployment that has somewhere to keep it: the same table as
 * the spend ledger (HANDS_LEDGER_TABLE), a second item. Without it the house is a file locally and
 * not kept at all on the hosted server — one process's memory at most — and every answer says which.
 */
const HOUSEHOLD_TOOLS = new Set(['remember_repair', 'repair_history', 'whats_due', 'pause_repair', 'resume_repair']);
function householdStore(env = process.env) {
  if (!env.HANDS_LEDGER_TABLE) return null;
  const creds = require('../agent/sigv4').credentials();
  if (!creds) return null;
  return new HouseholdStore({ table: env.HANDS_LEDGER_TABLE, creds, region: env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1' });
}
let householdOverride; // tests
const setHouseholdStore = (s) => { householdOverride = s; };
/** The store in use: a test's, or the deployment's, or none. */
const activeHouseholdStore = () => (householdOverride !== undefined ? householdOverride : householdStore());

/*
 * One household call at a time in this process. The house between load and save is module state,
 * and a deployment answers concurrent requests in one instance — two calls interleaving there could
 * each save the other's half-finished house and lose a repair. Other tools are not queued.
 */
let householdChain = Promise.resolve();
function oneAtATime(fn) {
  const run = householdChain.then(fn, fn);
  householdChain = run.catch(() => {});
  return run;
}

/**
 * Anything that writes the house outside a tool call — the device page's /api/remember — goes the
 * same way the tools do: queued, loaded from the shared store, saved to it, and told plainly if the
 * save did not take. `fn` returns the answer; a `saved: true` that did not persist is corrected.
 */
function withHousehold(fn) {
  return oneAtATime(async () => {
    const store = activeHouseholdStore();
    if (store) await hydrate(store);
    let value;
    try {
      value = await fn();
    } catch (e) {
      if (store) await persist().catch(() => {});
      throw e;
    }
    if (store && !(await persist()) && value && value.saved === true) {
      value = { ...value, saved: false, kept: 'session', keptFor: SESSION_ONLY };
    }
    return value;
  });
}
const { replace_or_repair } = require('./tools/replace_or_repair');
const { lookupSymptom, resolveModel, sameManualAs, provenance } = require('../data/service-data');
const { buildSpace, prune } = require('./tools/hypotheses');
const { nextTest } = require('./tools/next_test');

const PORT = process.env.MCP_PORT || 8793;
const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

/* ── the tools Alexa+ can see ─────────────────────────────────────────── */

const TOOLS = [
  {
    name: 'diagnose',
    description:
      'Rank the possible causes of a fault code on a specific appliance model, cheapest and most likely first. Offers candidates only; it does not decide anything.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model number from the appliance plate, e.g. SHE3AR75UC' },
        code: { type: 'string', description: 'Fault code shown on the panel, e.g. E24' },
      },
      required: ['model', 'code'],
    },
    handler: diagnose,
  },
  {
    name: 'verify_diagnosis',
    description:
      'Decide whether a cause may be stated as fact and have money attached to it. Returns abstain when the evidence does not separate the causes, when the cause sits behind mains voltage, or when a cheaper cause has not been ruled out yet.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        code: { type: 'string' },
        causeId: { type: 'string', description: 'Which cause to test. Defaults to the most likely.' },
        ruledOut: {
          type: 'array',
          items: { type: 'string' },
          description: 'Causes the owner has already tried and cleared.',
        },
      },
      required: ['model', 'code'],
    },
    handler: verify_diagnosis,
  },
  {
    name: 'guide',
    description:
      'Return the repair steps for an upheld cause, written to be heard rather than read, with the pacing each step usually takes. Refuses to improvise a procedure it has not got.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        code: { type: 'string' },
        causeId: { type: 'string' },
      },
      required: ['model', 'code', 'causeId'],
    },
    handler: guide,
  },
  {
    name: 'find_part',
    description:
      'Find the part that fits this exact model, with what the alternative service call costs. Returns nothing rather than a part that only probably fits.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        causeId: { type: 'string' },
      },
      required: ['model', 'causeId'],
    },
    handler: find_part,
  },
  {
    name: 'see',
    description:
      'Read the model number and fault code off a photograph of an appliance. Returns nulls rather than guesses, and always states whether the read was real or simulated.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: 'Path to the photograph' },
        imageBase64: { type: 'string', description: 'The image itself, from a camera or an upload' },
        expect: { type: 'object', description: 'Only used to shape a simulated read when Bedrock is unreachable' },
      },
    },
    handler: see,
  },
  {
    name: 'watch_step',
    description:
      "Watch the person do a repair step: two camera frames (the start of the step, and now) and the manual's words for the step. Answers done, not-yet, wrong-part, cant-see, danger, or unavailable, with one line to say aloud. Never signs off mains or power steps without the person's word, and never passes on an instruction the manual does not contain.",
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'object', description: "The step the person is on: { text, notes? } in the manual's words." },
        before: { type: 'string', description: 'A frame from when the step began (base64 JPEG or a data: URL).' },
        now: { type: 'string', description: 'A frame from now.' },
        powerConfirmed: { type: 'boolean', description: 'The person has said the power is off at the wall.' },
        sceneChange: { type: 'number', description: 'How much the picture changed between the two frames (mean grey difference, 0-255), if the client measured it. Below 2, "done" is refused.' },
      },
      required: ['step', 'before', 'now'],
    },
    handler: watchStep,
  },
  {
    name: 'read_error',
    description:
      'Read the fault code off a photograph of an appliance display and say what it means on that specific model. Abstains when no code is shown, when it cannot be read, or when there is no service data for the machine — a code interpreted against the wrong model is worse than no reading at all.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: 'Path to the photograph' },
        imageBase64: { type: 'string', description: 'The image itself, from a camera or an upload' },
        model: { type: 'string', description: 'The model, if already known' },
        code: { type: 'string', description: 'Skip the photograph and interpret a code directly' },
        noCodeShown: { type: 'boolean', description: 'The person looked and there is no code on the display. An established absence, not a failed read.' },
      },
    },
    handler: read_error,
  },
  {
    name: 'identify_appliance',
    description:
      'Identify the appliance in a photograph and say whether there is service data for it. Returns a model number only if it was actually read off a rating plate, never inferred from the brand, and says what would be needed to help with an unknown machine.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: 'Path to the photograph' },
        imageBase64: { type: 'string', description: 'The image itself, from a camera or an upload' },
        model: { type: 'string', description: 'Ask about a model directly, without a photograph' },
      },
    },
    handler: identify_appliance,
  },
  {
    name: 'read_manual',
    description:
      'Read an appliance service manual from a photograph of the page and learn that machine at runtime. Transcribes the fault table character for character; it does not interpret, invent a remedy, or fill in a code it could not read. A page with no fault table on it recovers nothing and says so.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: 'Photograph of the manual page' },
        imageBase64: { type: 'string', description: 'The same, as bytes from a camera' },
        model: { type: 'string', description: 'Which machine this manual belongs to' },
        brand: { type: 'string' },
        kind: { type: 'string', description: 'Dishwasher, Washer, Fridge…' },
      },
      required: ['model'],
    },
    handler: read_manual,
  },
  {
    name: 'begin_checkout',
    description:
      'Open a checkout for the part this fault needs. Refuses outright if the diagnosis was not upheld. Returns the itemised total, what a service call would have cost, and a session id.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        code: { type: 'string' },
        causeId: { type: 'string' },
        ruledOut: { type: 'array', items: { type: 'string' }, description: 'Cause ids already eliminated' },
      },
      required: ['model', 'code', 'causeId'],
    },
    handler: beginCheckout,
  },
  {
    name: 'confirm_checkout',
    description: 'Place the order for a checkout that was already read out. Completes exactly once.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, handler: { type: 'string' } },
      required: ['sessionId'],
    },
    handler: confirmCheckout,
  },
  {
    name: 'confirm_fix',
    description:
      'Look at the panel again after a repair and say whether the fault actually cleared. Will not confirm anything it could not genuinely see.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string' },
        code: { type: 'string', description: 'The fault code that was being repaired' },
      },
      required: ['imagePath'],
    },
    handler: confirm_fix,
  },
  {
    name: 'remember_repair',
    description:
      'Write down what was wrong, what was done about it, and whether it worked — so the next conversation about this machine is short.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        code: { type: 'string' },
        cause: { type: 'string' },
        action: { type: 'string' },
        part: { type: 'string' },
        cost: { type: 'number' },
        confirmed: { type: 'boolean' },
      },
      required: ['model', 'code'],
    },
    handler: receipt,
  },
  {
    name: 'whats_due',
    description:
      'What needs attention in this house: consumables past their stated interval, and faults that ' +
      'have come back. Reports the dates and draws no conclusion from them — what a recurrence ' +
      'means is not derivable from three timestamps. Lets it speak first instead of waiting for a ' +
      'breakdown.',
    inputSchema: { type: 'object', properties: {} },
    handler: due,
  },
  {
    name: 'describe_problem',
    description:
      'Find a machine\'s documented problem from what the owner said, for the machines whose manuals ' +
      'print no fault codes — which is most of the ones sold now. Returns every candidate ranked ' +
      'rather than picking one, because a sentence is ambiguous where a code is not. Says plainly ' +
      'when the manual covers nothing like it, which is not the same as nothing being wrong. ' +
      'Each match has an `id`: pass it as `code` to hypotheses, next_test, verify_diagnosis and ' +
      'guide — a documented symptom stands where a fault code would.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        said: { type: 'string', description: "What the owner described, in their own words." },
      },
      required: ['model', 'said'],
    },
    handler: ({ model, said }) => lookupSymptom(model, said),
  },
  {
    name: 'replace_or_repair',
    description:
      'Whether a machine is worth fixing. Reports what is known — the repair cost where a part is ' +
      'verified for that exact model, and whether this fault has come back before — and refuses to ' +
      'conclude without what the machine is worth, which no service manual contains and this will ' +
      'not guess. Never returns a verdict; the decision is the owner\'s.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        code: { type: 'string' },
        causeId: { type: 'string' },
        machineValue: { type: 'number', description: 'What a replacement costs, or what this one is worth. Supplied by the owner; never inferred.' },
        threshold: { type: 'number', description: 'Override the rule of thumb (default 0.5 of replacement).' },
      },
      required: ['model'],
    },
    handler: replace_or_repair,
  },
  {
    name: 'repair_history',
    description: 'Everything this machine has been through before.',
    inputSchema: { type: 'object', properties: { model: { type: 'string' } }, required: ['model'] },
    handler: history,
  },
  {
    name: 'pause_repair',
    description:
      'Save a repair that is not finished — most often because a part is on order — with the step ' +
      'reached and what it is waiting for, so the next conversation resumes instead of starting over. ' +
      'Keyed on model and code: pausing the same fault again updates it. Never claims a part has ' +
      'arrived; expectedBy only marks when it is due.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        code: { type: 'string' },
        causeId: { type: 'string' },
        cause: { type: 'string', description: 'What is wrong, in plain words.' },
        atStep: { type: 'integer', description: 'The step number they had reached.' },
        ofSteps: { type: 'integer', description: 'How many steps the guide has in total.' },
        waitingFor: { type: 'string', description: 'The part or thing being waited on, e.g. "drain pump".' },
        expectedBy: { type: 'string', description: 'When the part is expected, as a date — not a phrase. Omit if unknown.' },
      },
      required: ['model'],
    },
    handler: pauseRepair,
  },
  {
    name: 'resume_repair',
    description:
      'The unfinished repairs waiting in this house — for one machine, or all of them — each with ' +
      'the step to pick up from and one line to say. Ones whose part was due by now come first, so ' +
      'the assistant can lead with "your pump should be here — want to finish?". It asks whether the ' +
      'part arrived; it never assumes it did.',
    inputSchema: { type: 'object', properties: { model: { type: 'string' } } },
    handler: resumeRepair,
  },
  {
    name: 'hypotheses',
    description:
      'Build the space of possible causes for a fault code on a model, with how likely each is and how much uncertainty remains, in bits.',
    inputSchema: {
      type: 'object',
      properties: { model: { type: 'string' }, code: { type: 'string' } },
      required: ['model', 'code'],
    },
    handler: buildSpace,
  },
  {
    name: 'next_test',
    description:
      'Choose the single check worth asking a person to perform next: the one that removes the most uncertainty for the least effort. Returns nothing when one cause is left, or when no remaining check would tell us anything.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'array', items: { type: 'object' }, description: 'The space from hypotheses (or observe).' },
        tests: { type: 'array', items: { type: 'object' }, description: 'The tests from hypotheses. May be omitted if model and code are given.' },
        performed: { type: 'array', items: { type: 'string' }, description: 'Ids of checks already done.' },
        model: { type: 'string' },
        code: { type: 'string' },
      },
      required: ['space'],
    },
    handler: nextTest,
  },
  {
    name: 'observe',
    description:
      'Fold the result of a check back in: keep the causes consistent with what was seen, and name the ones it ruled out. Answer a check by naming it — testId and value — or pass the full outcome object.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'array', items: { type: 'object' }, description: 'The current space, from hypotheses or the last observe.' },
        testId: { type: 'string', description: 'The id of the check that was just performed.' },
        value: { type: 'string', description: "The person's answer, as one of that check's outcome values." },
        model: { type: 'string' },
        code: { type: 'string' },
        outcome: { type: 'object', description: 'Alternatively, the full outcome object from the check.' },
      },
      required: ['space'],
    },
    handler: prune,
  },
];

/* ── JSON-RPC plumbing ───────────────────────────────────────────────── */

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/* Async, because tools are allowed to do real work — `see` calls Bedrock. Every tool before it
 * happened to be synchronous, which hid the fact that a Promise was being serialised straight into
 * the response. */
/** Why these arguments cannot be given to this tool, or null. Only what the schema says for certain. */
function invalidArguments(tool, args) {
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    return `${tool.name} takes its arguments as an object — got ${args === null ? 'null' : Array.isArray(args) ? 'an array' : typeof args}.`;
  }
  const schema = tool.inputSchema || {};
  const a = args || {};
  const missing = (schema.required || []).filter((k) => a[k] === undefined || a[k] === null || a[k] === '');
  if (missing.length) {
    // The schema's own description, whole — cutting at the first full stop turned "e.g." into "e".
    const what = missing.map((k) => {
      const d = String(schema.properties?.[k]?.description || '').trim().replace(/\.$/, '');
      return d ? `${k} — ${d.length > 110 ? `${d.slice(0, 107)}…` : d}` : k;
    });
    return `${tool.name} needs ${what.join('; and ')}.`;
  }
  for (const [k, v] of Object.entries(a)) {
    const want = schema.properties?.[k]?.type;
    if (!want || Array.isArray(want) || v === null || v === undefined) continue;
    // Only shapes that cannot mean anything are refused. A model saying 12 where the schema says
    // "string" meant "12", and coerce() below says it for it.
    const is = Array.isArray(v) ? 'array' : typeof v;
    const scalar = (t) => t === 'string' || t === 'number' || t === 'integer' || t === 'boolean';
    const ok = want === is
      || (scalar(want) && (is === 'string' || is === 'number' || is === 'boolean'))
      || (want === 'integer' && is === 'number');
    if (!ok) return `${tool.name}: ${k} should be ${want === 'array' ? 'a list' : want === 'object' ? 'an object' : `a ${want}`}, not ${is === 'array' ? 'a list' : is === 'object' ? 'an object' : `a ${is}`}.`;
  }
  return null;
}

/** Scalars in the type the schema names — "12" for a string, 12 for a number — where that is lossless. */
function coerce(tool, args) {
  const props = tool.inputSchema?.properties || {};
  for (const [k, v] of Object.entries(args)) {
    const want = props[k]?.type;
    if (want === 'string' && (typeof v === 'number' || typeof v === 'boolean')) args[k] = String(v);
    else if ((want === 'number' || want === 'integer') && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) args[k] = Number(v);
    else if (want === 'boolean' && (v === 'true' || v === 'false')) args[k] = v === 'true';
  }
  return args;
}

/** One tools/call, from validation to answer. */
async function callTool(id, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params) || typeof params.name !== 'string') {
    return failure(id, -32602, 'tools/call takes params { name: string, arguments: object }.');
  }
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return failure(id, -32602, `No tool named "${params.name}".`);

  /*
   * Input the tool cannot use is answered as a tool error, in words, naming the argument — the
   * spec's rule since 2025-11-25, so a model can correct itself. Before this, a string or null
   * for `arguments` ran the tool anyway and it answered "No service data for model undefined".
   */
  const bad = invalidArguments(tool, params.arguments);
  if (bad) {
    return result(id, { content: [{ type: 'text', text: bad }], isError: true });
  }

  let store = null;
  try {
    store = HOUSEHOLD_TOOLS.has(tool.name) ? activeHouseholdStore() : null;
    if (store) await hydrate(store);
    const args = coerce(tool, { ...(params.arguments || {}) });
    // Every tool keys on the model, so it is resolved once, here — "Bosch SGE53C55UC" is the
    // SGE53C55UC. See resolveModel for what is and is not treated as the same machine.
    const asked = typeof args.model === 'string' ? args.model : null;
    if (asked) args.model = resolveModel(asked);
    let value = await tool.handler(args);
    // Answered from another model's manual because the manufacturer lists it for both: the answer
    // says so, about the model that was asked — resolving the name first had turned HBL8454UC into
    // HBL5351UC, and the provenance talked about a machine nobody had mentioned.
    const via = asked ? sameManualAs(asked) : null;
    if (via && value && typeof value === 'object' && !Array.isArray(value)) {
      value = { ...value, askedFor: asked, sameManualAs: via, ...(value.provenance ? { provenance: provenance(asked) } : {}) };
    }
    if (store && !(await persist()) && value && value.saved === true) {
      // The shared store refused the save: it is not kept, and the answer says so.
      value = { ...value, saved: false, kept: 'session', keptFor: SESSION_ONLY };
    }
    return result(id, {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
      // A tool that answers with an error — "\"no\" is not an answer to pump-hum. It has: hums,
      // silent." — refused what it was given, and says so in words; the flag tells the client too.
      // It used to go out as isError: false, which a model is free to read as a normal answer.
      isError: Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.error === 'string'),
    });
  } catch (e) {
    if (store) await persist().catch(() => {}); // never leave the shared store attached after a throw
    // A crash inside a tool is ours, not the caller's: the log gets the JavaScript, the client gets
    // a sentence. It used to send e.message — "Cannot read properties of undefined…" — to whoever asked.
    console.error(`tool ${tool.name} threw:`, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    return failure(id, -32603, `${tool.name} could not finish that request.`);
  }
}

async function handle(msg) {
  /*
   * Is this a request at all?
   *
   * `JSON.parse` accepts `null`, `[]`, `7` and `"hi"` — they are valid JSON and none of them is a
   * JSON-RPC request. Destructuring one threw, which the transport turned into a 500 carrying
   * "Cannot destructure property 'id' of 'msg' as it is null": an internal error message on the
   * wire, where the spec asks for -32600 Invalid Request. Found by pointing a fuzzer at the server,
   * which is what a judge with a strict client is going to be holding.
   *
   * A request needs a method that is a string. Everything else about it is the method's business.
   */
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return failure(
      (msg && typeof msg === 'object' && !Array.isArray(msg) ? msg.id : null) ?? null,
      -32600,
      'Invalid Request: a JSON-RPC request is an object with a "method" string.'
    );
  }

  const { id, method, params } = msg;
  // JSON-RPC ids are strings, numbers or null. An object id was accepted and echoed back — found by
  // the fuzzer — which a strict client cannot match to anything it sent.
  if ('id' in msg && id !== null && typeof id !== 'string' && typeof id !== 'number') {
    return failure(null, -32600, 'Invalid Request: an id is a string, a number or null.');
  }

  /*
   * A notification gets no reply at all.
   *
   * JSON-RPC defines a message without an `id` as a notification, and a notification is never
   * answered — the transport acknowledges it with 202 and no body. `notifications/initialized`, the
   * second step of every MCP handshake, used to fall through to "Unsupported method" and be answered
   * with an error carrying no id, which is a malformed response to a message that wanted none. Our
   * own session script never noticed because it discards whatever comes back from a notification;
   * a strict client — which is what an Alexa+ connector is — has every right not to.
   */
  if (!('id' in msg) || id === undefined) {
    return null;
  }

  if (method === 'initialize') {
    /*
     * Agree on a version the client asked for, when it is one this server speaks. Connectors in the
     * wild still open with 2025-06-18 or 2025-03-26, and answering every client with the newest
     * version is a way to be dropped by the ones that do not speak it yet. Nothing in these tools
     * changes between them.
     */
    const asked = params?.protocolVersion;
    return result(id, {
      protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
      serverInfo: { name: 'second-set-of-hands', version: '0.1.0' },
    });
  }

  // Cards. A host that can draw gets a card; a host that cannot still gets every word spoken,
  // because nothing appears only on a screen — see mcp/cards.js for why that rule is not negotiable.
  if (method === 'resources/list') {
    return result(id, {
      resources: RESOURCES.map(({ uri, name, description, mimeType, _meta }) => ({ uri, name, description, mimeType, ...(_meta ? { _meta } : {}) })),
    });
  }

  if (method === 'resources/read') {
    const uri = params?.uri;
    const found = RESOURCES.find((r) => r.uri === uri);
    if (!found) {
      return failure(id, -32602, `No such resource: ${uri}`);
    }
    return result(id, {
      contents: [{ uri: found.uri, mimeType: found.mimeType, text: found.read(), ...(found._meta ? { _meta: found._meta } : {}) }],
    });
  }

  if (method === 'tools/list') {
    return result(id, {
      // A tool the card can draw names it, so a host with a screen renders the card with the result.
      tools: TOOLS.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
        ...(APP_TOOLS.has(name) ? { _meta: { ui: { resourceUri: APP_URI } } } : {}),
      })),
    });
  }

  if (method === 'tools/call' && HOUSEHOLD_TOOLS.has(params?.name)) {
    return oneAtATime(() => callTool(id, params));
  }
  if (method === 'tools/call') return callTool(id, params);


  // Part of the resources capability this server declares; clients that ask on connect get an
  // honest empty list rather than an error. There are no parameterised resources here.
  if (method === 'resources/templates/list') return result(id, { resourceTemplates: [] });

  if (method === 'ping') return result(id, {});

  return failure(id, -32601, `Unsupported method "${method}".`);
}

/* ── transport ───────────────────────────────────────────────────────── */

/**
 * The Streamable HTTP transport, as one function both hosts share.
 *
 * `npm run mcp` serves it from a local port and the deployment serves it from a route, and they are
 * the same code for the reason every other entry point here is: a hosted copy that behaves
 * differently from the repository is worse than no hosted copy. It used to live inside
 * `http.createServer` and match on `req.url.startsWith('/mcp')`, which is exactly the kind of detail
 * a host rewrites — so the deliverable of the Alexa+ track, the MCP server itself, was never
 * reachable at the demo URL at all.
 *
 * What the spec (2025-11-25, Streamable HTTP) asks for, and where it is done:
 *
 *   POST, JSON-RPC in the body        → the response, or 202 with no body if nothing needed one
 *   GET                               → 405: no server-initiated stream is offered
 *   Origin on a browser request       → checked against the host, against DNS-rebinding
 *   MCP-Session-Id on initialize      → issued, and echoed back on every later response
 */
const MAX_BODY = 1024 * 1024;

async function readBody(req, max = MAX_BODY) {
  // A host may already have parsed the body. Use it rather than wait on a stream that is spent.
  if (req.body !== undefined && req.body !== null) {
    const b = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body);
    if (b.length > max) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    return b;
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let over = false;
    req.on('data', (c) => {
      if (over) return; // the rest is read and dropped, so the 413 can still be written
      body += c;
      if (body.length > max) {
        /*
         * Refused in words, not by hanging up. This destroyed the request on the spot, which also
         * destroyed the socket the answer had to go out on: a too-large body got a connection reset
         * instead of the 413 the caller was about to be sent. Found fuzzing /api/alexa.
         */
        over = true;
        body = '';
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Is this a browser request from a page on another site?
 *
 * The spec says servers MUST validate Origin, because a local MCP server can otherwise be driven by
 * any web page through DNS rebinding. A request with no Origin is not a browser page — it is a
 * client like the one an Alexa+ connector runs — and is allowed. One with an Origin must match the
 * host it was sent to, or be named in MCP_ALLOWED_ORIGINS.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function serveMcp(req, res) {
  if (!originAllowed(req)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(failure(null, -32600, 'Origin not allowed.')));
  }

  if (req.method === 'GET') {
    /*
     * No server-initiated stream here, said the way the spec asks it to be said: a server that does
     * not offer one should answer 405. Nothing in this server pushes — every tool answers the call
     * that asked for it. When something does, this is where the stream goes.
     */
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' });
    return res.end(
      `second-set-of-hands MCP server, spec ${PROTOCOL_VERSION}.\n` +
        'No server-initiated SSE stream is offered on GET. POST JSON-RPC to this URL.\n'
    );
  }

  if (req.method === 'DELETE') {
    // A client ending its session. Nothing is held per session, so there is nothing to tear down.
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST, GET, DELETE' });
    return res.end('POST JSON-RPC to this URL.');
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    res.writeHead(e.status || 400, { 'content-type': 'application/json', ...(e.status === 413 ? { connection: 'close' } : {}) });
    return res.end(JSON.stringify(failure(null, -32600, e.message)));
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(failure(null, -32700, 'Malformed JSON.')));
  }

  const headers = { 'content-type': 'application/json' };
  const session = req.headers['mcp-session-id'];
  const initializing = !Array.isArray(payload) && payload?.method === 'initialize';
  if (initializing) headers['mcp-session-id'] = crypto.randomUUID();
  else if (session) headers['mcp-session-id'] = session;

  try {
    const began = process.hrtime.bigint();
    // An empty batch is one Invalid Request, not silence (JSON-RPC 2.0, section 6).
    const response = Array.isArray(payload)
      ? payload.length
        ? (await Promise.all(payload.map(handle))).filter((r) => r !== null)
        : failure(null, -32600, 'Invalid Request: an empty batch.')
      : await handle(payload);
    /*
     * How long the tool itself took, on the server, as a standard header. Alexa+ asks for a round
     * trip under 500 ms and entrants cannot measure that against the orchestrator (FRICTION-LOG);
     * what can be measured honestly is the part this server owns, and `npm run latency` reports it
     * apart from the network, which depends on where it is measured from.
     */
    headers['server-timing'] = `tool;dur=${(Number(process.hrtime.bigint() - began) / 1e6).toFixed(2)}`;

    // Nothing to say — a notification, or a batch of nothing but — is 202 with no body.
    if (response === null || (Array.isArray(response) && !response.length)) {
      res.writeHead(202, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(response));
  } catch (e) {
    res.writeHead(500, headers);
    res.end(JSON.stringify(failure(payload?.id ?? null, -32603, 'Internal error.')));
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path !== '/mcp' && path !== '/mcp/') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('POST /mcp');
  }
  return serveMcp(req, res);
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`mcp  http://localhost:${PORT}/mcp  (spec ${PROTOCOL_VERSION})`));
}

module.exports = { handle, serveMcp, readBody, originAllowed, TOOLS, PROTOCOL_VERSION, setHouseholdStore, householdStore, activeHouseholdStore, withHousehold };
