const PIP_COLORS: Record<string, string> = {
  W: 'bg-mana-w text-black',
  U: 'bg-mana-u text-white',
  B: 'bg-mana-b text-white',
  R: 'bg-mana-r text-white',
  G: 'bg-mana-g text-white',
  C: 'bg-mana-c text-black',
};

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

export function ManaPip({ color, size = 20 }: { color: string; size?: number }) {
  const cls = PIP_COLORS[color] ?? 'bg-mana-c text-black';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold ${cls}`}
      style={{ width: size, height: size, fontSize: size * 0.6 }}
      aria-label={color}
    >
      {color}
    </span>
  );
}

/** Render a colour-identity string ('WU') as pips, or a colourless dot. */
export function ManaPips({ identity, size = 20 }: { identity: string; size?: number }) {
  const colors = WUBRG.filter((c) => identity.includes(c));
  if (colors.length === 0) {
    return <ManaPip color="C" size={size} />;
  }
  return (
    <span className="inline-flex gap-0.5">
      {colors.map((c) => (
        <ManaPip key={c} color={c} size={size} />
      ))}
    </span>
  );
}
