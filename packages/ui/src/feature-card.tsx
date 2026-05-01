import { ReactNode } from "react";

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-neutral-800/60 bg-neutral-900/40 p-6 backdrop-blur-sm transition-all duration-500 hover:border-neutral-700/80 hover:bg-neutral-800/40 hover:shadow-2xl hover:shadow-emerald-900/10 sm:p-8">
      {/* Hover glow effect */}
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-emerald-500/0 to-emerald-500/0 transition-all duration-700 group-hover:from-emerald-500/10 group-hover:to-transparent" />
      
      {/* Icon container */}
      <div className="relative mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-700/50 bg-neutral-800/50 text-emerald-400 shadow-sm transition-all duration-500 group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 group-hover:text-emerald-300 group-hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]">
        {icon}
      </div>

      {/* Content */}
      <h3 className="relative mb-2 text-lg font-semibold tracking-tight text-neutral-100 transition-colors duration-300 group-hover:text-white">
        {title}
      </h3>
      
      <p className="relative text-sm leading-6 text-neutral-400 transition-colors duration-300 group-hover:text-neutral-300">
        {description}
      </p>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-emerald-500/0 to-transparent transition-all duration-700 group-hover:via-emerald-500/50 sm:left-8 sm:right-8" />
    </div>
  );
}