import type { PageServerLoad } from "./$types";

class Vehicle {
  constructor(
    public id: string,
    public make: string,
  ) {}
}

export const load: PageServerLoad = () => {
  console.log("plain object", { id: 42, name: "Honda Civic", year: 2019 });
  console.log("nested", { a: { b: { c: { d: { e: "deep" } } } } });
  console.log("array", [1, 2, 3, "four", { five: 5 }]);
  console.log("Map", new Map([["k", 1], ["k2", 2]]));
  console.log("Set", new Set([1, 2, 3]));
  console.log("Date", new Date("2026-05-22T14:00:00Z"));
  console.log("RegExp", /^foo.*bar$/gi);
  console.log("URL", new URL("https://example.com/path?q=1"));
  console.log("BigInt", 123n);
  console.log("class instance", new Vehicle("v1", "Honda"));
  console.log("JSON-shaped string", JSON.stringify({ auto: "parsed" }));

  const circular: { name: string; self?: unknown } = { name: "loop" };
  circular.self = circular;
  console.log("circular", circular);

  return {};
};
