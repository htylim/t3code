import { useNowMinute } from "../../hooks/useNowMinute";
import { formatSidebarRecency, type SidebarRecency } from "../Sidebar.presentation";

/** Render the section presenter's clock, even when the live shell advances independently. */
export function SidebarThreadRecency(props: { recency: SidebarRecency }) {
  const nowMinute = useNowMinute();
  const { timestamp, description } = props.recency;
  if (timestamp === null) return null;
  const isoTimestamp = new Date(timestamp).toISOString();
  return (
    <time dateTime={isoTimestamp} aria-label={`${description}: ${isoTimestamp}`}>
      {formatSidebarRecency(props.recency, Date.parse(`${nowMinute}:00.000Z`))}
    </time>
  );
}
