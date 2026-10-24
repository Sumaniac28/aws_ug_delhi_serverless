/** Count-up numbers: fast at first, settling on the real value. */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** The number to show at progress t (0..1); never overshoots and always ends exactly on the target. */
export const valueAt = (target: number, t: number) => (t >= 1 ? target : Math.round(target * easeOutCubic(t)));

const fmt = new Intl.NumberFormat('en-IN');
/** Indian digit grouping, as the rest of the site uses: 1,360 and 1,00,000. */
export const formatCount = (n: number) => fmt.format(n);
