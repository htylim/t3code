import forgeHeaderDark from "../../../../../assets/fork/forge/header-dark.webp";
import forgeHeaderLight from "../../../../../assets/fork/forge/header-light.webp";
import { useTheme } from "../../hooks/useTheme";

/** Decorative Forge overlay that leaves the header's text and controls on their theme colors. */
export function ForkHeaderArtwork() {
  const { resolvedTheme } = useTheme();

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <img
        alt=""
        className="h-full w-full"
        height={724}
        src={resolvedTheme === "dark" ? forgeHeaderDark : forgeHeaderLight}
        width={2172}
      />
    </div>
  );
}
