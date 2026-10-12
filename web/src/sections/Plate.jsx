import { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

/**
 * Point it at the plate.
 *
 * Nobody knows their model number. It is a sticker on the inside of a door, in eight-point type,
 * behind a rubber seal, and the whole session depends on reading it — a procedure for the wrong
 * model is worse than no procedure. So the way in is a camera, because that is the one thing
 * somebody kneeling on a floor definitely has.
 *
 * ── What is actually happening ──────────────────────────────────────────────
 *
 * The frame goes to `/api/see`, which is one prompt, one parser, and one place where a simulated
 * read is labelled. It comes back with what it read AND how sure it is, and if it is not sure it
 * says so rather than picking the closest thing. With no AWS credentials it answers from a
 * recorded read and labels itself simulated, in that same field, so a stand-in can never be
 * mistaken for a reading.
 *
 * Nothing leaves the browser until somebody presses the button. The camera is not started on page
 * load and there is no preview running in the background of a page nobody asked to be filmed by.
 */
export default function Plate() {
  const video = useRef(null);
  const stream = useRef(null);
  const [state, setState] = useState('idle');
  const [read, setRead] = useState(null);
  const [why, setWhy] = useState(null);
  const still = useReducedMotion();

  async function open() {
    setWhy(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      setState('live');
    } catch (e) {
      // A refused camera is a normal answer, not an error state. Say what happened and stop.
      setWhy(
        e.name === 'NotAllowedError'
          ? 'The browser did not give this page the camera. Nothing was captured.'
          : `No camera available here — ${e.message}`
      );
      setState('idle');
    }
  }

  function close() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState('idle');
  }

  async function capture() {
    const el = video.current;
    if (!el) return;

    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext('2d').drawImage(el, 0, 0);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    close();
    setState('reading');
    try {
      const res = await fetch('/api/see', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64, imageFormat: 'jpeg', expect: { kind: 'rating plate' } }),
      });
      setRead(await res.json());
      setState('read');
    } catch (e) {
      setWhy(`The server could not read it: ${e.message}`);
      setState('idle');
    }
  }

  return (
    <section className="wrap" id="plate">
      <header className="head">
        <h2>Nobody knows their model number</h2>
        <p className="lede">
          It is a tiny sticker inside the door. Point the camera at it, and an unsure read is
          reported as unsure rather than rounded to the nearest model that exists.
        </p>
      </header>

      <div className="viewfinder">
        <div className="viewfinder__frame" data-state={state}>
          <video ref={video} playsInline muted hidden={state !== 'live'} />

          {state !== 'live' && (
            <div className="viewfinder__off">
              {/*
                What it is looking for, drawn rather than photographed: the shape of a rating plate,
                with no maker's name on it. An empty black box read as a camera that had failed.
              */}
              <div className="sticker" aria-hidden="true">
                <span>MODEL</span><b>SHE3AR75UC</b>
                <span>SERIAL</span><b>••••••••••</b>
                <span>RATING</span><b>120V ~ 60Hz</b>
              </div>
              <span className="viewfinder__bracket" aria-hidden="true" />
              <p>{state === 'reading' ? 'reading the plate…' : 'the camera is off · this is what it looks for'}</p>
            </div>
          )}

          {/* The bracket you line the sticker up inside. It is the only instruction needed. */}
          {state === 'live' && <span className="viewfinder__bracket" aria-hidden="true" />}
        </div>

        <div className="viewfinder__side">
          <div className="viewfinder__controls">
            {state === 'live' ? (
              <>
                <button className="btn" onClick={capture}>
                  Read the plate
                </button>
                <button className="try" onClick={close}>
                  Turn the camera off
                </button>
              </>
            ) : (
              <button className="btn" onClick={open} disabled={state === 'reading'}>
                {state === 'reading' ? 'Reading…' : 'Use the camera'}
              </button>
            )}
          </div>

          {why && <p className="viewfinder__why">{why}</p>}

          <AnimatePresence mode="wait">
            {read && (
              <motion.dl
                className="reading"
                key={JSON.stringify(read).slice(0, 60)}
                initial={{ opacity: 0, y: still ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: still ? 0 : 0.26 }}
              >
                {read.simulated && (
                  <div className="reading__sim">
                    simulated — no AWS credentials on this server, so this is a recorded read and
                    says so
                  </div>
                )}
                {['brand', 'model', 'kind', 'serial'].map(
                  (k) =>
                    read[k] && (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{read[k]}</dd>
                      </div>
                    )
                )}
                {typeof read.confidence === 'number' && (
                  <div>
                    <dt>how sure</dt>
                    <dd>{Math.round(read.confidence * 100)}%</dd>
                  </div>
                )}
                {read.unsure && (
                  <div className="reading__unsure">
                    <dt>not sure</dt>
                    <dd>{read.unsure}</dd>
                  </div>
                )}
              </motion.dl>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
