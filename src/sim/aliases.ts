const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Rename legacy Impella keys in a patient or scenario object before normalisation. */
export function migrateLegacyKeys(spec: unknown): { spec: unknown; warnings: string[] } {
  if (spec === undefined || spec === null) return { spec, warnings: [] };
  if (!isObj(spec)) return { spec, warnings: [] };
  let renamed = false;

  const out = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;

  const support = isObj(out.support) ? { ...out.support } : undefined;
  if (support && "impella" in support) {
    if (support.coroPump === undefined) support.coroPump = support.impella;
    delete support.impella;
    out.support = support;
    renamed = true;
  }

  const devices = isObj(out.devices) ? { ...out.devices } : undefined;
  if (devices) {
    if ("impella" in devices) {
      if (devices.coroPump === undefined) devices.coroPump = devices.impella;
      delete devices.impella;
      renamed = true;
    }
    if ("impellaRp" in devices) {
      if (devices.coroPumpRp === undefined) devices.coroPumpRp = devices.impellaRp;
      delete devices.impellaRp;
      renamed = true;
    }
    if (renamed) out.devices = devices;
  }

  return { spec: out, warnings: renamed ? ["renamed"] : [] };
}

/** Case card device chips in markdown (`- devices: ECMO, Impella`). */
export function migrateLegacyDeviceWords(devices: string[]): { devices: string[]; warnings: string[] } {
  let renamed = false;
  const out = devices.map((d) => {
    if (/^impella$/i.test(d.trim())) {
      renamed = true;
      return "CoroPump";
    }
    return d;
  });
  return { devices: out, warnings: renamed ? ["renamed"] : [] };
}
