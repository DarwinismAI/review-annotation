import { expect, test } from "@playwright/test";

const ADMIN_COOKIE = { Cookie: "dev_role=admin" };
const SCALE = [
  { score: 1, label: "Failed", description: "fail" },
  { score: 2, label: "Pass", description: "pass" },
];

test.describe("Rubric metrics API", () => {
  test("invalid metric patch does not persist partial rubric changes", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Atomic metric ${Date.now()}`,
        domain: "safety_compliance",
        description: "temporary metric",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;

    try {
      const badName = `SHOULD_NOT_PERSIST ${Date.now()}`;
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: badName,
          domain: "medical",
          scale: [{ score: 1, label: "Only", description: "" }],
        },
      });
      expect(patch.status()).toBe(400);

      const fetchedRes = await request.get(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
      expect(fetchedRes.ok()).toBeTruthy();
      const fetched = (await fetchedRes.json()).data;
      expect(fetched).toMatchObject(created);
    } finally {
      await request.delete(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
    }
  });

  test("editing a metric preserves its criterion id", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Stable metric ${Date.now()}`,
        domain: "safety_compliance",
        description: "before",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;

    try {
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: `${created.name} updated`,
          domain: created.domain,
          description: "after",
          required: false,
          scale: SCALE,
        },
      });
      expect(patch.ok()).toBeTruthy();
      const updated = (await patch.json()).data;
      expect(updated.criterionId).toBe(created.criterionId);
      expect(updated).toMatchObject({
        name: `${created.name} updated`,
        description: "after",
        required: false,
      });
    } finally {
      await request.delete(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
    }
  });
});
