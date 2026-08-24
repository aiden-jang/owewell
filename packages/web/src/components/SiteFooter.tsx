import { Fragment, type ReactNode } from 'react';
import { siteFooterLinks } from '@aidenjang/auth-client';
import { AUTH_ORIGIN } from '../lib/api';
import { ThemeSwitch } from './ThemeSwitch';

// Content (credit + legal links) is shared via siteFooterLinks so it stays in sync across apps;
// the styling here is owewell's own theme so the footer matches the app.
const links = siteFooterLinks(AUTH_ORIGIN);

export function SiteFooter(): ReactNode {
  return (
    <footer className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 px-5 py-8 text-center text-xs text-muted">
      {links.map((link, i) => (
        <Fragment key={link.href}>
          {i > 0 && <span aria-hidden>·</span>}
          <a
            href={link.href}
            {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
            className="tap hover:text-accent hover:underline"
          >
            {link.label}
          </a>
        </Fragment>
      ))}
      <span aria-hidden>·</span>
      <ThemeSwitch />
    </footer>
  );
}
