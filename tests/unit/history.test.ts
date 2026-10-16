import { describe, expect, it } from "vitest";
import { HistoryNavigation, normalizeHistory } from "../../src/features/history/model/history";

describe("history identity", () => {
	it("preserves exact whitespace and reconciles deletion to a surviving neighbour", () => {
		const rows = normalizeHistory(["A", " B ", "C"], 10);
		const navigation = new HistoryNavigation();
		expect(navigation.move(1, "draft", rows)).toBe("A");
		expect(navigation.move(1, "A", rows)).toBe(" B ");
		expect(navigation.reconcile([rows[0]!, rows[2]!])).toBe("C");
		expect(navigation.reconcile([])).toBe("draft");
	});
});
