import { NavLink } from 'react-router-dom';
import {
  BookOpenIcon,
  Cog6ToothIcon,
  RectangleStackIcon,
  Square2StackIcon,
} from '@heroicons/react/24/outline';
import {
  BookOpenIcon as BookOpenSolid,
  Cog6ToothIcon as Cog6ToothSolid,
  RectangleStackIcon as RectangleStackSolid,
  Square2StackIcon as Square2StackSolid,
} from '@heroicons/react/24/solid';

const TABS = [
  { to: '/', label: 'Library', icon: RectangleStackIcon, active: RectangleStackSolid },
  { to: '/binder', label: 'Binder', icon: BookOpenIcon, active: BookOpenSolid },
  { to: '/decks', label: 'Decks', icon: Square2StackIcon, active: Square2StackSolid },
  { to: '/settings', label: 'Settings', icon: Cog6ToothIcon, active: Cog6ToothSolid },
];

/** Paths that show the tab bar: the top-level section screens. */
export const TAB_PATHS = new Set(TABS.map((t) => t.to));

/** Bottom navigation between the app's main sections. */
export function TabBar() {
  return (
    <nav className="grid grid-cols-4 border-t border-surface-2 bg-surface-0" aria-label="Sections">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `flex min-h-tap flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${
              isActive ? 'text-accent' : 'text-neutral-500 active:text-neutral-300'
            }`
          }
        >
          {({ isActive }) => {
            const Icon = isActive ? t.active : t.icon;
            return (
              <>
                <Icon className="h-6 w-6" aria-hidden />
                {t.label}
              </>
            );
          }}
        </NavLink>
      ))}
    </nav>
  );
}
