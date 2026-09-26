import { useEffect, useRef, useState } from 'react';
import { createSettle, grey, THUMB_W, THUMB_H } from '../lib/settle.js';

/**
 * Watching the step being done.
 *
 * The camera is small on purpose. Nobody is looking at it — they are four feet away with their
 * hands inside a machine — so the step stays the headline and what the camera saw arrives as one
 * line underneath it, and aloud when the page is reading aloud. The one loud state is danger.
 *
 * ── What leaves the browser, and when ──────────────────────────────────────
 *
 * Nothing until somebody presses "Watch me". Then a 32×24 grey thumbnail is kept four times a
 * second and never sent anywhere; a real frame, 640 px wide, goes to /api/watch only when the
 * picture has moved and then held still (the moment a result is visible), or when the person asks
 * for a look. Two frames go each time — the start of the step and now — and the server keeps
 * neither. When there is no vision on the host, the answer says so, and the repair goes on by voice
 * exactly as it did before.
 */
export default function Watch({ step, stepKey, aloud }) {
  const video = useRef(null);
  const stream = useRef(null);
  const thumbs = useRef(null);
  const loop = useRef(null);
  const before = useRef(null);
  const settle = useRef(createSettle());
  const busy = useRef(false);
  const [on, setOn] = useState(false);
  const [why, setWhy] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [looking, setLooking] = useState(false);
  const [power, setPower] = useState(false);
  const [left, setLeft] = useState(settle.current.left);

  /** The current picture as a 640-wide JPEG — plenty to read a filter or a hose, small to send. */
  function frame() {
    const el = video.current;
    if (!el || !el.videoWidth) return null;
    const w = Math.min(640, el.videoWidth);
    const h = Math.round((el.videoHeight * w) / el.videoWidth);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(el, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  }

  function say(line) {
    if (!aloud || !line || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  async function look({ powerConfirmed = power } = {}) {
    if (busy.current || !before.current) return;
    const now = frame();
    if (!now) return;
    busy.current = true;
    setLooking(true);
    try {
      const res = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: { text: step.say, notes: step.detail ? [step.detail] : [] }, before: before.current, now, powerConfirmed }),
      });
      const r = await res.json();
      setAnswer(r);
      // "One moment" from the throttle is not worth saying aloud; everything else is.
      if (res.status !== 429) say(r.say);
    } catch (e) {
      setAnswer({ verdict: 'unavailable', say: 'I can’t see right now — tell me when it’s done.', reason: `The server could not be reached: ${e.message}` });
    } finally {
      busy.current = false;
      setLooking(false);
      setLeft(settle.current.left);
    }
  }

  function tick() {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    if (!thumbs.current) {
      thumbs.current = document.createElement('canvas');
      thumbs.current.width = THUMB_W;
      thumbs.current.height = THUMB_H;
    }
    const ctx = thumbs.current.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(el, 0, 0, THUMB_W, THUMB_H);
    const g = grey(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
    // No "before" yet (the first moments of watching): nothing to compare with, so nothing to spend.
    if (!before.current) return;
    if (settle.current.feed(g, performance.now()) === 'look') look();
  }

  async function open() {
    setWhy(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      setOn(true);
      // The step's "before" is the picture when watching begins — the camera needs a moment to
      // settle its exposure first, or "before" is a dark frame and every later one looks changed.
      setTimeout(() => { before.current = frame(); }, 700);
      loop.current = setInterval(tick, 250);
    } catch (e) {
      setWhy(e.name === 'NotAllowedError' ? 'The browser did not give this page the camera. Nothing was captured.' : `No camera available here — ${e.message}`);
    }
  }

  function close() {
    clearInterval(loop.current);
    loop.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    before.current = null;
    setOn(false);
  }

  // A new step: a new "before", a fresh allowance of looks, and no stale verdict on screen.
  useEffect(() => {
    settle.current.step();
    setLeft(settle.current.left);
    setAnswer(null);
    setPower(false);
    if (stream.current) before.current = frame();
  }, [stepKey]);

  useEffect(() => () => close(), []);

  const v = answer?.verdict;

  return (
    <div className="watch" data-on={on} data-verdict={v || 'none'}>
      <div className="watch__eye">
        <video ref={video} playsInline muted hidden={!on} aria-label="What the camera sees" />
        {!on && <span className="watch__off">camera off</span>}
        {on && <span className="watch__dot" data-looking={looking} aria-hidden="true" />}
      </div>

      <div className="watch__side">
        {answer ? (
          <p className="watch__say" role="status">{answer.say}</p>
        ) : (
          <p className="watch__hint">
            {on ? 'Watching. Do the step — it looks when you pause.' : 'It can watch you do this step and say what it sees.'}
          </p>
        )}

        {answer?.verdict === 'unavailable' && answer.reason && <p className="watch__why">{answer.reason}</p>}
        {why && <p className="watch__why">{why}</p>}

        <div className="watch__controls">
          {on ? (
            <>
              {answer?.heldBack === 'mains' && !power && (
                <button className="btn btn--onscreen" onClick={() => { setPower(true); look({ powerConfirmed: true }); }}>
                  It&rsquo;s off at the wall
                </button>
              )}
              <button className="btn btn--quiet" onClick={() => { if (settle.current.ask(performance.now())) look(); }} disabled={looking}>
                {looking ? 'looking…' : '“done — have a look”'}
              </button>
              <button className="btn btn--quiet" onClick={close}>stop watching</button>
            </>
          ) : (
            <button className="btn btn--quiet" onClick={open}>watch me do it</button>
          )}
        </div>

        {on && (
          <p className="watch__small">
            {left} look{left === 1 ? '' : 's'} left this step · frames go to Amazon Bedrock to be read and are not kept
          </p>
        )}
      </div>
    </div>
  );
}
