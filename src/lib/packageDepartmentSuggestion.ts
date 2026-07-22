import type { PackageBenefitRecord, SaleRecord } from '../types';
import { serviceMapKey, type Department, type KnownService, type ServiceDepartmentMap } from './departments';

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
 *
 * Two ways a package's benefits get found, combined for maximum coverage:
 *  1. By invoice number (primary, exact) - every sales line for this package's map key (see
 *     serviceMapKey - per-instance for custom/uncoded packages, not the shared "type:Package"
 *     bucket) has an invoiceNo; Package Benefits rows sharing that invoiceNo are its actual
 *     purchased benefits, with no dependency on the package's name matching between the two
 *     exports.
 *  2. By package name (fallback) - Package Benefits Detail is a point-in-time balance snapshot, so
 *     a long-since-expired/fully-consumed package purchase may not appear in any recent snapshot by
 *     invoice even though the same-named package is still sold and tracked for other guests -
 *     matching by name catches those.
 */
export function suggestPackageDepartments(
  packages: KnownService[],
  records: SaleRecord[],
  packageBenefits: PackageBenefitRecord[],
  mapping: ServiceDepartmentMap,
  knownServices: KnownService[],
): PackageDepartmentSuggestion[] {
  const nameToDepartment = new Map<string, Department>();
  for (const s of knownServices) {
    const department = mapping[s.serviceKey];
    if (department) nameToDepartment.set(s.serviceName.trim().toLowerCase(), department);
  }

  const benefitsByInvoice = new Map<string, Set<string>>();
  const benefitsByPackageName = new Map<string, Set<string>>();
  for (const b of packageBenefits) {
    if (!benefitsByInvoice.has(b.invoiceNo)) benefitsByInvoice.set(b.invoiceNo, new Set());
    benefitsByInvoice.get(b.invoiceNo)!.add(b.benefitName.trim());

    const nameKey = b.packageName.trim().toLowerCase();
    if (!benefitsByPackageName.has(nameKey)) benefitsByPackageName.set(nameKey, new Set());
    benefitsByPackageName.get(nameKey)!.add(b.benefitName.trim());
  }

  const invoicesByServiceKey = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.itemType !== 'Package') continue;
    const mapKey = serviceMapKey(r.serviceKey, r.serviceName);
    if (!invoicesByServiceKey.has(mapKey)) invoicesByServiceKey.set(mapKey, new Set());
    invoicesByServiceKey.get(mapKey)!.add(r.invoiceNo);
  }

  const suggestions: PackageDepartmentSuggestion[] = [];
  for (const pkg of packages) {
    const benefitNames = new Set<string>();

    for (const invoiceNo of invoicesByServiceKey.get(pkg.serviceKey) ?? []) {
      for (const name of benefitsByInvoice.get(invoiceNo) ?? []) benefitNames.add(name);
    }
    for (const name of benefitsByPackageName.get(pkg.serviceName.trim().toLowerCase()) ?? []) benefitNames.add(name);

    if (benefitNames.size === 0) continue;

    const sortedBenefitNames = [...benefitNames].sort();
    const departmentsFound = [
      ...new Set(sortedBenefitNames.map((n) => nameToDepartment.get(n.toLowerCase())).filter((d): d is Department => !!d)),
    ];

    suggestions.push({
      serviceKey: pkg.serviceKey,
      benefitNames: sortedBenefitNames,
      departmentsFound,
      suggestedDepartment: departmentsFound.length === 1 ? departmentsFound[0] : null,
    });
  }
  return suggestions;
}
