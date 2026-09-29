const mode = String(process.argv[2] || process.env.DB_CLIENT || "mysql").trim().toLowerCase();

process.env.DB_CLIENT = mode === "sqlite" ? "sqlite" : "mysql";

console.log(`Starting MediLink with ${process.env.DB_CLIENT.toUpperCase()} database mode...`);

require("../server");
