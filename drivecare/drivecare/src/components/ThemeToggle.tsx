import { IconMoon, IconSun } from './Icons';
import { IconButton } from './ui';
import { useData } from '../lib/data';
import { saveSettings } from '../lib/settings';

/** One tap switches between light and dark (long-term choice is saved; "Match iPhone" lives in Settings). */
export default function ThemeToggle() {
  const { settings } = useData();
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <IconButton label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => void saveSettings({ theme: isDark ? 'light' : 'dark' })}>
      {isDark ? <IconSun /> : <IconMoon />}
      <span className="sr-only">{settings.theme}</span>
    </IconButton>
  );
}
