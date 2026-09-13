"use client";

export default function FixturePicker({
  selectedId,
  fixtureIds,
}: {
  selectedId: string;
  fixtureIds: string[];
}) {
  return (
    <select
      aria-label="Switch fixture"
      value={selectedId}
      onChange={(event) => {
        const url = new URL(window.location.href);
        url.searchParams.set("fixture", event.target.value);
        window.location.assign(url.href);
      }}
      style={{
        maxWidth: "min(260px, 40vw)",
        padding: "6px 28px 6px 10px",
        border: "1px solid var(--border, #343434)",
        borderRadius: 6,
        background: "#202020",
        color: "#e6e6e6",
        font: "inherit",
        fontSize: 12,
        colorScheme: "dark",
        cursor: "pointer",
      }}
    >
      <optgroup label="Fixtures">
        {fixtureIds.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </optgroup>
      <optgroup label="Workspace states">
        <option value="empty">Empty workspace</option>
        <option value="new-emitter">New emitter</option>
      </optgroup>
    </select>
  );
}
