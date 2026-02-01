interface LogoProps {
  size?: 'sm' | 'lg'
}

function PickelhaubeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 32"
      fill="currentColor"
      className={className}
    >
      {/* Spike on top */}
      <path d="M12 0 L13.5 8 L10.5 8 Z" />
      {/* Helmet dome */}
      <path d="M4 14 Q4 8 12 8 Q20 8 20 14 L20 20 Q20 24 12 26 Q4 24 4 20 Z" />
      {/* Visor/brim */}
      <path d="M2 18 Q2 16 6 15 L6 17 Q4 17.5 4 18.5 Q4 20 6 20 L6 22 Q2 21 2 18 Z" />
      <path d="M22 18 Q22 16 18 15 L18 17 Q20 17.5 20 18.5 Q20 20 18 20 L18 22 Q22 21 22 18 Z" />
      {/* Chin strap hint */}
      <path d="M6 24 Q6 28 12 30 Q18 28 18 24" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function Logo({ size = 'sm' }: LogoProps) {
  const isLarge = size === 'lg'
  return (
    <div className={`flex items-center ${isLarge ? 'gap-3' : 'gap-2'}`}>
      <PickelhaubeIcon className={isLarge ? 'w-8 h-10' : 'w-5 h-6'} />
      <span
        style={{ fontFamily: 'Inter' }}
        className={`font-extrabold ${isLarge ? 'text-3xl' : 'text-lg'}`}
      >
        Bismark
      </span>
    </div>
  )
}
