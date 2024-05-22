/**
 * evaluate to Y if T is any, otherwise T
 */
export type IfAny<T, Y> = 0 extends (1 & T) ? Y : T
