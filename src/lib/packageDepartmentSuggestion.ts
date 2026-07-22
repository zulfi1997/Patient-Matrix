import type { PackageBenefitRecord } from '../types';
import type { Department, KnownService, ServiceDepartmentMap } from './departments';

export interface PackageDepartmentSuggestion {
  serviceKey: string;
  /** Distinct benefit (underlying service) names found for this package in the Package Benefits data. */
  benefitNames: string[];
  /** Distinct departments those benefits resolve to, via the already-mapped standalone services with the same name. */
  departmentsFound: Department[];
  /** Set only when every resolved benefit agrees on one department - safe to auto-apply. */
  suggestedDepartment: Department | null;
}

/**
 * For each Package-type service, looks up its constituent benefits (the actual services it bundles,
 * e.g. a "VIP Beauty Package" redeeming "Laser Hair Removal" and "HydraFacial" sessions) from the
 * uploaded Package Benefits Detail data, and resolves each benefit's department by matching its name
 * against the standalone services already mapped in `mapping` - so a package inherits a department
 * suggestion from services that are individually sold and already categorized, instead of requiring
 * a separate manual guess per package. A package whose benefits span more than one department is
 * surfaced (departmentsFound has 2+ entries) but not auto-suggested, since attributing it to a single
 * department would misrepresent it - splitting its revenue proportionally across departments is a
 * job for the analysis itself, not this mapping step.
 */
export function suggestPackageDepartments(
  packages: KnownService[],
  packageBenefits: PackageBenefitRecord[],
  mapping: ServiceDepartmentMap,
  knownServices: KnownService[],
): PackageDepartmentSuggestion[] {
  const nameToDepartment = new Map<string, Department>();
  for (const s of knownServices) {
    const department = mapping[s.serviceKey];
    if (department) nameToDepartment.set(s.serviceName.trim().toLowerCase(), department);
  }

  const benefitsByPackageName = new Map<string, Set<string>>();
  for (const b of packageBenefits) {
    const key = b.packageName.trim().toLowerCase();
    if (!benefitsByPackageName.has(key)) benefitsByPackageName.set(key, new Set());
    benefitsByPackageName.get(key)!.add(b.benefitName.trim());
  }

  const suggestions: PackageDepartmentSuggestion[] = [];
  for (const pkg of packages) {
    const benefitNames = [...(benefitsByPackageName.get(pkg.serviceName.trim().toLowerCase()) ?? [])].sort();
    if (benefitNames.length === 0) continue;

    const departmentsFound = [...new Set(benefitNames.map((n) => nameToDepartment.get(n.toLowerCase())).filter((d): d is Department => !!d))];

    suggestions.push({
      serviceKey: pkg.serviceKey,
      benefitNames,
      departmentsFound,
      suggestedDepartment: departmentsFound.length === 1 ? departmentsFound[0] : null,
    });
  }
  return suggestions;
}
