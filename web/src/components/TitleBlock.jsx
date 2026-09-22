/**
 * The title block, in the corner of the drawing.
 *
 * Every engineering document has one: which document this is, what it covers, who checked it. It
 * is the most boring part of a service manual and the first thing a technician looks at, because
 * it is the part that says whether the rest can be trusted.
 *
 * So the first screen has one. It also solves a plain compositional problem — the headline wrapped
 * at 27 characters and left the right half of the screen empty — but it is not filler: every field
 * in it is something the library actually recorded about the machine being asked about, including
 * the two that matter most, which manual it was read from and whether anybody checked it against
 * the pages.
 */
export default function TitleBlock({ machine }) {
  if (!machine) return null;

  const rows = [
    ['document', machine.source || 'entered by hand'],
    ['symptoms', machine.symptoms || machine.codes?.length || 0],
    ['causes', machine.causes],
    machine.rejected?.length ? ['rows rejected', machine.rejected.length] : null,
    [
      'checked',
      machine.tier === 'checked'
        ? 'against the pages'
        : machine.tier === 'hand'
          ? 'entered by hand'
          : 'not yet',
    ],
  ].filter(Boolean);

  return (
    <aside className="titleblock" aria-label="what is being read">
      <p className="titleblock__what">reading</p>
      <p className="titleblock__name">
        {machine.brand} {machine.kind}
      </p>
      <p className="titleblock__model">{machine.model}</p>

      <dl className="titleblock__rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
