import { Avatar } from './Avatar';

const covers: Record<string, string> = {
  dinner: '/art/group-dinner.svg',
  trip: '/art/group-trip.svg',
  home: '/art/group-home.svg',
};

export function GroupArtwork({ name }: { name: string }) {
  const cover = covers[name.trim().toLowerCase()];
  return cover ? (
    <img className="group-artwork" src={cover} alt="" width={36} height={36} />
  ) : (
    <Avatar name={name} />
  );
}
