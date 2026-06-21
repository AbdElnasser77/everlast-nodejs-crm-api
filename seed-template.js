const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const templates = [
    {
      name: "Wellness Check-In",
      metaTemplateName: "wellness_check_in",
      metaTemplateId: "mock_meta_001",
      category: "GENERAL",
      approvalStatus: "APPROVED",
      language: "en_US",
      header: "Hello from Everlast Wellness!",
      body: "Hi {{customer_name}}, this is {{agent_name}} from Everlast Wellness. We wanted to check in and see how you're feeling after your last session. Is there anything we can help you with today?",
      footer: "Everlast Wellness • Unsubscribe anytime",
      buttons: [
        { id: "btn_1", title: "Book a Session" },
        { id: "btn_2", title: "Talk to Agent" },
      ],
      isActive: true,
    },
    {
      name: "Re-engagement Follow Up",
      metaTemplateName: "reengagement_follow_up",
      metaTemplateId: "mock_meta_002",
      category: "RE_ENGAGEMENT",
      approvalStatus: "APPROVED",
      language: "en_US",
      header: "We miss you!",
      body: "Hi {{customer_name}}, it's been a while since we've heard from you! {{agent_name}} here from Everlast Wellness. We have some exciting new treatments and offers available. Would you like to reconnect?",
      footer: "Everlast Wellness",
      buttons: [
        { id: "btn_1", title: "View Offers" },
        { id: "btn_2", title: "Call Us" },
      ],
      isActive: true,
    },
  ];

  for (const t of templates) {
    const created = await prisma.template.create({ data: t });
    console.log(`Created template: [${created.id}] ${created.name} (${created.approvalStatus})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
