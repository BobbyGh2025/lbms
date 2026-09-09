"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: next-themes resolves the theme on the client
  // only. Render a stable placeholder until mounted. The mounted-guard is the
  // documented pattern for next-themes; the synchronous setState is intentional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = theme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle theme"
          onClick={() => mounted && setTheme(isDark ? "light" : "dark")}
          className="h-9 w-9"
        >
          {mounted ? (
            isDark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )
          ) : (
            <Moon className="h-4 w-4 opacity-0" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
      </TooltipContent>
    </Tooltip>
  );
}
