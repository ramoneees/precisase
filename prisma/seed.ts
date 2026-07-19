/**
 * Idempotent seed for manual QA.
 *
 * Run via `prisma db seed` (wired in prisma.config.ts `migrations.seed`).
 *
 * Inserted fixtures:
 *   - 5 users (4 regular + 1 moderator) with stable, well-known passwords
 *     (every account uses `password123` — this is dev/test only; see the
 *     TODO at the bottom for the production path).
 *   - 8 posts across both categories and 3 locales, covering every status
 *     (pending / active / closed / rejected) so a tester can exercise the
 *     full state machine from `docs/ARCHITECTURE.md §5.3`.
 *   - 3 `Interest` rows so the FR11 closure-notification flow has something
 *     to actually notify.
 *
 * Idempotent: every insert checks first (`upsert`/`findUnique` + skip),
 * so re-running `prisma db seed` against an already-seeded DB is a no-op.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../src/generated/prisma/client";
import { encrypt } from "../src/server/crypto/contact-encryption";

const TEST_PASSWORD = "password123";

async function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: 2 }); // argon2id
}

// Phone fixtures are stored as canonical E.164 directly (no per-seed
// re-validation needed — every fixture below is already a known-valid
// E.164 for the country it claims).
async function encryptPhone(e164: string): Promise<Buffer> {
  return encrypt(e164);
}

interface UserFixture {
  email: string;
  displayName: string;
  password: string;
  role: "user" | "moderator" | "admin";
  uiLocale: string;
  country: string;
  timeZone: string;
  currency: string;
  phone: string | null;
}

const USERS: UserFixture[] = [
  {
    email: "ana.silva@example.com",
    displayName: "Ana Silva",
    password: TEST_PASSWORD,
    role: "user",
    uiLocale: "pt-PT",
    country: "PT",
    timeZone: "Europe/Lisbon",
    currency: "EUR",
    phone: "+351912345678",
  },
  {
    email: "joao.santos@example.com",
    displayName: "João Santos",
    password: TEST_PASSWORD,
    role: "user",
    uiLocale: "pt-PT",
    country: "PT",
    timeZone: "Europe/Lisbon",
    currency: "EUR",
    phone: "+351932222111",
  },
  {
    email: "maria.costa@example.com",
    displayName: "Maria Costa",
    password: TEST_PASSWORD,
    role: "user",
    uiLocale: "pt-BR",
    country: "BR",
    timeZone: "America/Sao_Paulo",
    currency: "BRL",
    phone: "+5511912345678",
  },
  {
    email: "carlos.moderator@example.com",
    displayName: "Carlos Mendes",
    password: TEST_PASSWORD,
    role: "moderator",
    uiLocale: "pt-PT",
    country: "PT",
    timeZone: "Europe/Lisbon",
    currency: "EUR",
    phone: null,
  },
  {
    email: "priya.en@example.com",
    displayName: "Priya Sharma",
    password: TEST_PASSWORD,
    role: "user",
    uiLocale: "en",
    country: "US",
    timeZone: "America/New_York",
    currency: "USD",
    phone: null,
  },
];

interface PostFixture {
  id: string;
  authorEmail: string;
  categorySlug: "volunteering" | "donation";
  type: "request" | "offer";
  status: "pending" | "active" | "closed" | "rejected";
  title: string;
  description: string;
  contactMethod: "phone" | "whatsapp" | "email";
  contactValue: string;
  locale: string;
  rejectedReason?: string;
}

const VOLUNTEERING_CATEGORY_SLUG = "volunteering";
const DONATION_CATEGORY_SLUG = "donation";

const POSTS: PostFixture[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    authorEmail: "ana.silva@example.com",
    categorySlug: VOLUNTEERING_CATEGORY_SLUG,
    type: "request",
    status: "pending",
    title: "Preciso de voluntários para a festa de verão",
    description:
      "A Casa da Cidade está a organizar uma festa de verão no sábado e precisamos de 5 voluntários para ajudar na montagem e desmontagem. Almoço incluído.",
    contactMethod: "email",
    contactValue: "ana.silva@example.com",
    locale: "pt-PT",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    authorEmail: "ana.silva@example.com",
    categorySlug: VOLUNTEERING_CATEGORY_SLUG,
    type: "request",
    status: "active",
    title: "Procuro alguém para ajudar a mudar um sofá",
    description:
      "Tenho um sofá pesado para mudar no sábado de manhã. Preciso de duas pessoas durante 2-3 horas. Ofereço café e bolinhos.",
    contactMethod: "phone",
    contactValue: "+351912345678",
    locale: "pt-PT",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    authorEmail: "joao.santos@example.com",
    categorySlug: VOLUNTEERING_CATEGORY_SLUG,
    type: "offer",
    status: "active",
    title: "Ofereço aulas de inglês gratuitas",
    description:
      "Sou professor de inglês certificado e ofereço 1 hora por semana de aulas gratuitas para membros da comunidade que precisem de praticar conversação. Online ou presencial em Lisboa.",
    contactMethod: "email",
    contactValue: "joao.santos@example.com",
    locale: "pt-PT",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    authorEmail: "maria.costa@example.com",
    categorySlug: DONATION_CATEGORY_SLUG,
    type: "offer",
    status: "active",
    title: "Doação de roupas de bebê",
    description:
      "Tenho roupas de bebê (0-12 meses) em ótimo estado que meu filho cresceu. São 3 sacolas grandes — bodies, macacões, sapatos, etc. Retirada na zona sul de São Paulo.",
    contactMethod: "whatsapp",
    contactValue: "+5511912345678",
    locale: "pt-BR",
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    authorEmail: "maria.costa@example.com",
    categorySlug: DONATION_CATEGORY_SLUG,
    type: "request",
    status: "active",
    title: "Preciso de fraldas para recém-nascido",
    description:
      "Família de baixa renda, mãe solo com bebê de 2 meses. Preciso de fraldas RN (recém-nascido) e tamanho P. Qualquer quantidade ajuda.",
    contactMethod: "email",
    contactValue: "maria.costa@example.com",
    locale: "pt-BR",
  },
  {
    id: "66666666-6666-6666-6666-666666666666",
    authorEmail: "priya.en@example.com",
    categorySlug: VOLUNTEERING_CATEGORY_SLUG,
    type: "request",
    status: "active",
    title: "Looking for a Spanish conversation partner",
    description:
      "I'm an English speaker trying to learn Spanish (intermediate level). Looking for a native speaker who'd like to exchange — I can help with English, you help me with Spanish. 1 hour per week, online.",
    contactMethod: "email",
    contactValue: "priya.en@example.com",
    locale: "en",
  },
  {
    id: "77777777-7777-7777-7777-777777777777",
    authorEmail: "joao.santos@example.com",
    categorySlug: VOLUNTEERING_CATEGORY_SLUG,
    type: "offer",
    status: "closed",
    title: "Pintura grátis para um quarto (encerrado)",
    description:
      "Tinha-me oferecido para pintar um quarto em casa de alguém da comunidade, mas já não é necessário. A vaga está fechada.",
    contactMethod: "email",
    contactValue: "joao.santos@example.com",
    locale: "pt-PT",
  },
  {
    id: "88888888-8888-8888-8888-888888888888",
    authorEmail: "priya.en@example.com",
    categorySlug: DONATION_CATEGORY_SLUG,
    type: "offer",
    status: "rejected",
    title: "Free laptop (rejected — needs more details)",
    description:
      "I have an old laptop I'm not using.",
    contactMethod: "email",
    contactValue: "priya.en@example.com",
    locale: "en",
    rejectedReason: "Please add the laptop model, condition, and pickup/delivery options before resubmitting.",
  },
];

interface InterestFixture {
  postId: string;
  userEmail: string;
  message: string;
}

const INTERESTS: InterestFixture[] = [
  {
    postId: "22222222-2222-2222-2222-222222222222",
    userEmail: "joao.santos@example.com",
    message: "Posso ajudar no sábado de manhã!",
  },
  {
    postId: "44444444-4444-4444-4444-444444444444",
    userEmail: "ana.silva@example.com",
    message: "Posso retirar na sexta à tarde.",
  },
  {
    postId: "55555555-5555-5555-5555-555555555555",
    userEmail: "priya.en@example.com",
    message: "I can send diapers from the US if you cover shipping.",
  },
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const passwordHashes = new Map<string, string>();
  for (const u of USERS) {
    passwordHashes.set(u.email, await hashPassword(u.password));
  }
  const phoneCiphers = new Map<string, Uint8Array>();
  for (const u of USERS) {
    if (u.phone === null) continue;
    phoneCiphers.set(u.email, new Uint8Array(await encryptPhone(u.phone)));
  }

  try {
    for (const category of [
      { slug: VOLUNTEERING_CATEGORY_SLUG, key: "category.volunteering" },
      { slug: DONATION_CATEGORY_SLUG, key: "category.donation" },
    ] as const) {
      await prisma.category.upsert({
        where: { slug: category.slug },
        update: { key: category.key },
        create: { slug: category.slug, key: category.key },
      });
      console.log(`[seed] category "${category.slug}" ready`);
    }

    const categoryIdBySlug = new Map<string, string>();
    for (const slug of [VOLUNTEERING_CATEGORY_SLUG, DONATION_CATEGORY_SLUG]) {
      const c = await prisma.category.findUnique({ where: { slug } });
      if (!c) throw new Error(`category ${slug} missing after upsert`);
      categoryIdBySlug.set(slug, c.id);
    }

    for (const u of USERS) {
      const existing = await prisma.user.findUnique({ where: { email: u.email } });
      if (existing) {
        console.log(`[seed] user "${u.email}" already exists, skipping`);
        continue;
      }
      await prisma.user.create({
        data: {
          email: u.email,
          passwordHash: passwordHashes.get(u.email)!,
          displayName: u.displayName,
          phoneE164: u.phone,
          uiLocale: u.uiLocale,
          country: u.country,
          timeZone: u.timeZone,
          currency: u.currency,
          role: u.role,
          consentAt: new Date(),
        },
      });
      console.log(`[seed] user "${u.email}" created (${u.role}, ${u.uiLocale})`);
    }

    const userIdByEmail = new Map<string, string>();
    for (const u of USERS) {
      const user = await prisma.user.findUnique({ where: { email: u.email }, select: { id: true } });
      if (!user) throw new Error(`user ${u.email} missing after upsert`);
      userIdByEmail.set(u.email, user.id);
    }

    for (const p of POSTS) {
      const existing = await prisma.post.findUnique({ where: { id: p.id } });
      if (existing) {
        console.log(`[seed] post "${p.title}" already exists, skipping`);
        continue;
      }
      const categoryId = categoryIdBySlug.get(p.categorySlug);
      if (!categoryId) throw new Error(`category ${p.categorySlug} missing`);

      const isPhone = p.contactMethod === "phone" || p.contactMethod === "whatsapp";
      const encryptedContact = isPhone
        ? new Uint8Array(await encryptPhone(p.contactValue))
        : Buffer.from(p.contactValue, "utf8");

      await prisma.post.create({
        data: {
          id: p.id,
          authorId: userIdByEmail.get(p.authorEmail)!,
          categoryId,
          type: p.type,
          status: p.status,
          title: p.title,
          description: p.description,
          contactMethod: p.contactMethod,
          contactValue: encryptedContact,
          locale: p.locale,
          rejectedReason: p.rejectedReason ?? null,
          publishedAt: p.status === "active" || p.status === "closed" ? new Date(Date.now() - 1000 * 60 * 60 * 24 * 3) : null,
          closedAt: p.status === "closed" ? new Date(Date.now() - 1000 * 60 * 60 * 24) : null,
        },
      });
      console.log(`[seed] post "${p.title}" created (${p.status}, ${p.locale})`);
    }

    for (const i of INTERESTS) {
      const userId = userIdByEmail.get(i.userEmail);
      if (!userId) throw new Error(`user ${i.userEmail} missing for interest`);
      const existing = await prisma.interest.findUnique({
        where: { postId_userId: { postId: i.postId, userId } },
      });
      if (existing) {
        console.log(`[seed] interest by ${i.userEmail} on ${i.postId} already exists, skipping`);
        continue;
      }
      await prisma.interest.create({
        data: {
          postId: i.postId,
          userId,
          message: i.message,
        },
      });
      console.log(`[seed] interest by ${i.userEmail} on ${i.postId} created`);
    }

    console.log("\n[seed] done. Try signing in with:");
    console.log("       ana.silva@example.com / password123  (regular user, pt-PT)");
    console.log("       maria.costa@example.com / password123  (regular user, pt-BR)");
    console.log("       priya.en@example.com / password123  (regular user, en)");
    console.log("       carlos.moderator@example.com / password123  (moderator, pt-PT)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error);
  process.exitCode = 1;
});
