import React, { useEffect, useState } from "react";
import { motion } from "motion/react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  precision?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function AnimatedNumber({
  value,
  duration = 800,
  precision = 0,
  prefix = "",
  suffix = "",
  className = ""
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startValue = displayValue;
    const change = value - startValue;

    if (change === 0) {
      setDisplayValue(value);
      return;
    }

    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      
      // easeOutQuad easing
      const easeProgress = progress * (2 - progress);
      const currentVal = startValue + change * easeProgress;
      
      setDisplayValue(currentVal);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
      }
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [value, duration]);

  // Format the output
  const formatted = displayValue.toFixed(precision);
  
  // Add "+" sign for positive average scores if precision > 0 and value is positive
  const sign = precision > 0 && value > 0 && !prefix.includes("+") ? "+" : "";

  return (
    <motion.span
      initial={{ opacity: 0.8, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={className}
    >
      {sign}{prefix}{formatted}{suffix}
    </motion.span>
  );
}
