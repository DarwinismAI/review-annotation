interface LocalDevEnvironment {
  NODE_ENV?: string;
  LOCAL_DB_PATH?: string;
}

export function isLocalDevelopment(
  env: LocalDevEnvironment = process.env
): boolean {
  return env.NODE_ENV === "development" && Boolean(env.LOCAL_DB_PATH);
}
