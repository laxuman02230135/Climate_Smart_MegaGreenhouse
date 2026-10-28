import { redirect } from 'next/navigation';

/** The streamlined project has one entry point: the two-zone prototype lab. */
export default function HomePage() {
  redirect('/prototype-testing');
}
