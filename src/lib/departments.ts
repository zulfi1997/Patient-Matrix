export const DEPARTMENTS = ['Wellness', 'Derma', 'Facial', 'Laser', 'Biohacking'] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** serviceKey -> assigned department. A service with no entry here is unmapped. */
export type ServiceDepartmentMap = Record<string, Department>;
