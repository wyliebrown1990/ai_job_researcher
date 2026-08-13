export function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const argument = args[i]!;
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const value = args[i + 1];
    flags[argument.slice(2)] = value && !value.startsWith("--") ? args[++i]! : "true";
  }
  return { positional, flags };
}
