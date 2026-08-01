export type ReadAuthSession = {
  user: {
    id: string;
    email: string;
    name: string | null | undefined;
    role: string;
  };
};

type Claims = { userId: string; email: string };

type Authorized<T> = { status: "authorized"; response: T; session: ReadAuthSession };
type Unauthorized = { status: "unauthorized" };
type Forbidden = { status: "forbidden" };

export async function runAuthorizedRead<T>({
  getClaims,
  getProfile,
  startHandler,
  isAllowed,
}: {
  getClaims: () => Promise<Claims | null>;
  getProfile: (claims: Claims) => Promise<ReadAuthSession | null>;
  startHandler: (claims: Claims, session: Promise<ReadAuthSession>) => Promise<T>;
  isAllowed: (session: ReadAuthSession) => boolean;
}): Promise<Authorized<T> | Unauthorized | Forbidden> {
  const claims = await getClaims();
  if (!claims) return { status: "unauthorized" };

  const profilePromise = getProfile(claims);
  const sessionPromise = profilePromise.then((session) => {
    if (!session) throw new Error("UNAUTHORIZED");
    return session;
  });
  sessionPromise.catch(() => undefined);
  const handlerPromise = Promise.resolve().then(() => startHandler(claims, sessionPromise));
  const handlerSettled = handlerPromise.then(
    (response) => ({ ok: true as const, response }),
    (error) => ({ ok: false as const, error }),
  );

  const session = await profilePromise;
  if (!session) {
    await handlerSettled;
    return { status: "unauthorized" };
  }
  if (!isAllowed(session)) {
    await handlerSettled;
    return { status: "forbidden" };
  }

  const handlerResult = await handlerSettled;
  if (!handlerResult.ok) throw handlerResult.error;
  return { status: "authorized", response: handlerResult.response, session };
}
