export function participantLabels(people: readonly { userId: string; displayName: string }[]) {
  const groups = new Map<string, { userId: string; displayName: string }[]>();
  for (const person of people) {
    const key = person.displayName.trim().toLowerCase();
    const matches = groups.get(key) ?? [];
    matches.push(person);
    groups.set(key, matches);
  }
  return new Map(
    [...groups.values()].flatMap((matches) =>
      matches
        .sort((a, b) => a.userId.localeCompare(b.userId))
        .map(
          ({ userId, displayName }, i) =>
            [userId, matches.length > 1 ? `${displayName} (${i + 1})` : displayName] as const,
        ),
    ),
  );
}
