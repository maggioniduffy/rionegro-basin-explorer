/** Film grain over a whole page (.grain in globals.css). Its parent must be `relative`. */
export function Grain() {
  return (
    <div
      aria-hidden
      className="grain pointer-events-none absolute inset-0 z-5"
    />
  );
}
