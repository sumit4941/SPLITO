import { useId, type SVGProps } from 'react';

export interface SplitoLogoProps extends SVGProps<SVGSVGElement> {
  compact?: boolean;
  label?: string;
}

/**
 * The shared centre represents a common expense; the four orbiting pieces are
 * the people who split it while remaining part of one balanced system.
 */
export function SplitoLogo({
  compact = false,
  label = 'SPLITO',
  className,
  ...props
}: SplitoLogoProps) {
  const id = useId().replace(/:/g, '');
  const titleId = `${id}-title`;

  return (
    <svg
      aria-labelledby={titleId}
      className={['splito-logo', compact ? 'splito-logo--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
      role="img"
      viewBox={compact ? '0 0 56 56' : '0 0 188 56'}
      {...props}
    >
      <title id={titleId}>{label} — shared money in balance</title>
      <defs>
        <linearGradient
          id={`${id}-violet`}
          x1="5"
          x2="49"
          y1="7"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#5B37E4" />
        </linearGradient>
        <linearGradient
          id={`${id}-cyan`}
          x1="14"
          x2="47"
          y1="49"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#11B7D7" />
          <stop offset="1" stopColor="#58E0EE" />
        </linearGradient>
        <linearGradient
          id={`${id}-warm`}
          x1="8"
          x2="44"
          y1="42"
          y2="11"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FB7185" />
          <stop offset="1" stopColor="#F7B84B" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#372182" floodOpacity=".22" />
        </filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        <path
          d="M28 4.5a23.5 23.5 0 0 1 22.7 17.4l-9.6 2.6A13.6 13.6 0 0 0 28 14.3V4.5Z"
          fill={`url(#${id}-violet)`}
        />
        <path
          d="M51.5 28A23.5 23.5 0 0 1 34 50.7l-2.6-9.6A13.6 13.6 0 0 0 41.7 28h9.8Z"
          fill={`url(#${id}-cyan)`}
        />
        <path
          d="M28 51.5A23.5 23.5 0 0 1 5.3 34.1l9.6-2.7A13.6 13.6 0 0 0 28 41.7v9.8Z"
          fill={`url(#${id}-warm)`}
        />
        <path
          d="M4.5 28A23.5 23.5 0 0 1 22 5.3l2.6 9.6A13.6 13.6 0 0 0 14.3 28H4.5Z"
          fill="#25C78A"
        />
        <circle cx="28" cy="28" r="8.1" fill="var(--logo-center, #fffaf2)" />
        <path
          d="M25 24.5h6M25 28h6M25 31.5h3.8"
          stroke="#6544E9"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>
      {!compact && (
        <g aria-hidden="true">
          <text x="68" y="36.5" className="splito-logo__wordmark">
            SPLITO
          </text>
          <circle cx="178" cy="15" r="3" fill="#FB7185" />
        </g>
      )}
    </svg>
  );
}
