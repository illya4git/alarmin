/**
 * Top-level regions drawn inside an oblast's zoomed map (plan §3.5), with their own colour.
 * Kyiv city is an enclave of Kyivska: selecting it zooms into Kyivska with the city outlined.
 * `/v1/o/:oblastId` appends one digit per extra region, in this order, after the raions.
 */
export const ZOOM_EXTRAS: ReadonlyMap<number, readonly number[]> = new Map([[14, [31]]]);
