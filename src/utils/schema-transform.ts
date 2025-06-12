import { z, ZodTypeAny } from "zod";

export interface ZodPathSegments {
  segments: string[];
}

/**
 * Transform a Zod schema by replacing z.string().url() with z.number()
 * for better LLM handling of URLs
 */
export function transformSchema(
  schema: ZodTypeAny,
  path: string[] = []
): [ZodTypeAny, ZodPathSegments[]] {
  const urlPaths: ZodPathSegments[] = [];

  // Handle string with URL check
  if (schema instanceof z.ZodString) {
    const checks = (schema as any)._def.checks || [];
    const hasUrlCheck = checks.some((check: any) => check.kind === "url");
    
    if (hasUrlCheck) {
      urlPaths.push({ segments: path });
      return [z.number().describe(`URL reference index for ${path.join('.')}`), urlPaths];
    }
    return [schema, urlPaths];
  }

  // Handle objects
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)._def.shape();
    const newShape: Record<string, ZodTypeAny> = {};
    let changed = false;

    for (const [key, value] of Object.entries(shape)) {
      const [transformedSchema, childPaths] = transformSchema(value as ZodTypeAny, [...path, key]);
      newShape[key] = transformedSchema;
      
      if (transformedSchema !== value) {
        changed = true;
      }
      
      urlPaths.push(...childPaths);
    }

    const result = changed ? z.object(newShape) : schema;
    return [result, urlPaths];
  }

  // Handle arrays
  if (schema instanceof z.ZodArray) {
    const [transformedElement, childPaths] = transformSchema(
      (schema as any)._def.type,
      [...path, "[]"]
    );
    
    if (childPaths.length > 0) {
      return [z.array(transformedElement), childPaths];
    }
    
    return [schema, urlPaths];
  }

  // Handle unions
  if (schema instanceof z.ZodUnion) {
    const options = (schema as any)._def.options;
    const transformedOptions: ZodTypeAny[] = [];
    let changed = false;

    for (const option of options) {
      const [transformedOption, childPaths] = transformSchema(option, path);
      transformedOptions.push(transformedOption);
      
      if (transformedOption !== option) {
        changed = true;
      }
      
      urlPaths.push(...childPaths);
    }

    const result = changed ? z.union(transformedOptions as any) : schema;
    return [result, urlPaths];
  }

  // Handle optional
  if (schema instanceof z.ZodOptional) {
    const [transformedInner, childPaths] = transformSchema(
      (schema as any)._def.innerType,
      path
    );
    
    if (childPaths.length > 0) {
      return [z.optional(transformedInner), childPaths];
    }
    
    return [schema, urlPaths];
  }

  // Handle nullable
  if (schema instanceof z.ZodNullable) {
    const [transformedInner, childPaths] = transformSchema(
      (schema as any)._def.innerType,
      path
    );
    
    if (childPaths.length > 0) {
      return [z.nullable(transformedInner), childPaths];
    }
    
    return [schema, urlPaths];
  }

  // Return unchanged for other types
  return [schema, urlPaths];
}

/**
 * Inject URLs back into the extracted data based on the URL mapping
 */
export function injectUrls(
  data: any,
  segments: string[],
  urlMapping: Record<string | number, string>
): void {
  let current = data;
  
  // Navigate to the parent of the target field
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    
    if (segment === "[]") {
      // Handle array iteration
      if (Array.isArray(current)) {
        for (const item of current) {
          injectUrls(item, segments.slice(i + 1), urlMapping);
        }
        return;
      }
    } else {
      current = current[segment];
      if (!current) return;
    }
  }
  
  // Replace the numeric ID with the actual URL
  const lastSegment = segments[segments.length - 1];
  if (lastSegment !== "[]" && typeof current[lastSegment] === "number") {
    const urlId = current[lastSegment];
    const url = urlMapping[urlId];
    if (url) {
      current[lastSegment] = url;
    }
  }
}