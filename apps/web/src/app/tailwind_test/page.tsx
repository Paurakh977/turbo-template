import { FeatureCard } from "@repo/ui/feature-card";

export default function Home() {
  return (
    <main className="relative min-h-screen w-full bg-neutral-950 text-neutral-50 antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.15),transparent)]" />
      
      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 py-32 md:px-12 md:py-48">
        {/* Badge */}
        <div className="mb-8 flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/50 px-4 py-1.5 text-xs font-medium tracking-wide text-neutral-400 backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Now available in beta
        </div>

        {/* Hero typography */}
        <h1 className="max-w-3xl text-center text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
          Build faster with{" "}
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            less complexity
          </span>
        </h1>

        <p className="mt-6 max-w-lg text-center text-base leading-relaxed text-neutral-400 sm:text-lg md:text-xl">
          A minimal foundation for modern web applications. No bloat, just pure utility and intentional design.
        </p>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <button className="group relative inline-flex h-11 items-center justify-center overflow-hidden rounded-lg bg-emerald-500 px-8 text-sm font-medium text-white transition-all duration-300 hover:bg-emerald-400 hover:shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:ring-offset-2 focus:ring-offset-neutral-950 active:scale-95">
            <span className="relative z-10">Get started</span>
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </button>
          <button className="inline-flex h-11 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/50 px-8 text-sm font-medium text-neutral-300 backdrop-blur-sm transition-all duration-300 hover:border-neutral-700 hover:bg-neutral-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-neutral-700 active:scale-95">
            View documentation
          </button>
        </div>

        {/* Feature grid */}
        <div className="mt-32 grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            }
            title="Lightning fast"
            description="Optimized for performance with zero unnecessary dependencies and minimal bundle size."
          />
          <FeatureCard
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            }
            title="Beautiful defaults"
            description="Carefully crafted color palettes and spacing scales that just work out of the box."
          />
          <FeatureCard
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            }
            title="Fully typed"
            description="Built with TypeScript from the ground up for excellent developer experience."
          />
        </div>
      </div>
    </main>
  );
}