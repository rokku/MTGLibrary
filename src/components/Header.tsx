import { Link } from 'react-router-dom';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';

interface HeaderProps {
  title: string;
  back?: string;
  right?: React.ReactNode;
  accent?: string;
}

export function Header({ title, back, right, accent }: HeaderProps) {
  return (
    <header className="flex items-center gap-2 border-b border-surface-2 bg-surface-0 px-2 py-2">
      {back != null ? (
        <Link to={back} className="tap-target flex items-center justify-center rounded-lg active:bg-surface-2" aria-label="Back">
          <ChevronLeftIcon className="h-6 w-6" />
        </Link>
      ) : (
        <span className="ml-1 h-2 w-2 rounded-full" style={{ backgroundColor: accent ?? '#f59e0b' }} aria-hidden />
      )}
      <h1 className="flex-1 truncate px-1 text-lg font-semibold">{title}</h1>
      {right}
    </header>
  );
}
