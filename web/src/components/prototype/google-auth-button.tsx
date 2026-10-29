type GoogleAuthButtonProps = {
  children: string;
  onClick: () => void;
};

export function GoogleAuthButton({ children, onClick }: GoogleAuthButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface text-sm font-medium text-text shadow-sm transition-colors hover:bg-surface-2"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
        <path
          fill="#4285F4"
          d="M21.35 12.23c0-.72-.06-1.23-.2-1.77H12v3.45h5.37c-.11.86-.72 2.15-2.08 3.02l-.02.12 3.02 2.34.21.02c1.92-1.77 2.85-4.37 2.85-7.18Z"
        />
        <path
          fill="#34A853"
          d="M12 21.75c2.63 0 4.84-.87 6.45-2.34l-3.07-2.38c-.82.57-1.93.98-3.38.98a5.85 5.85 0 0 1-5.54-4.04l-.11.01-3.14 2.43-.04.11A9.75 9.75 0 0 0 12 21.75Z"
        />
        <path
          fill="#FBBC05"
          d="M6.46 13.97A5.9 5.9 0 0 1 6.15 12c0-.69.12-1.36.3-1.97l-.01-.13-3.18-2.47-.1.05A9.74 9.74 0 0 0 2.25 12c0 1.62.39 3.15.91 4.52l3.3-2.55Z"
        />
        <path
          fill="#EA4335"
          d="M12 5.99c1.83 0 3.06.79 3.77 1.45l2.75-2.68C16.83 3.2 14.63 2.25 12 2.25a9.75 9.75 0 0 0-8.84 5.23l3.29 2.55A5.85 5.85 0 0 1 12 5.99Z"
        />
      </svg>
      {children}
    </button>
  );
}
