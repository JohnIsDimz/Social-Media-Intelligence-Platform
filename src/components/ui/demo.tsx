import React from "react";
import AnoAI from "@/components/ui/animated-shader-background";
import { Button } from "@/components/ui/moving-border";

export const DemoOne = () => {
  return (
    <div className="w-full h-screen bg-black relative">
      <AnoAI />
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-white p-4">
        <h1 className="text-4xl font-display font-bold mb-4 tracking-tight">Animated Shader</h1>
        <p className="text-slate-300 font-sans max-w-md text-center">
          Custom WebGL fragment shader rendering dynamic aurora ripples in real time.
        </p>
      </div>
    </div>
  );
};

export function MovingBorderDemo() {
  return (
    <div className="flex items-center justify-center p-8 bg-slate-950 rounded-2xl border border-slate-800">
      <Button
        borderRadius="1.75rem"
        className="bg-slate-900 text-white border-slate-800 hover:bg-slate-800/80 transition-colors"
      >
        Borders are cool
      </Button>
    </div>
  );
}
