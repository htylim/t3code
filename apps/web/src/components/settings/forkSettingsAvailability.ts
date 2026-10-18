import { APP_STAGE_LABEL } from "../../branding";

// Development needs the real controls so fork features can be tested before packaging.
export const FORK_SETTINGS_AVAILABLE = import.meta.env.DEV || APP_STAGE_LABEL === "Fork";
