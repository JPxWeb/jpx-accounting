import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgePassage } from "@jpx-accounting/contracts";

import {
  configureKnowledgeRetrieval,
  queryKnowledge,
  type VectorKnowledgeRetriever,
} from "../../services/api/src/knowledge";

const fakePassage: KnowledgePassage = {
  id: "passage_test",
  docId: "doc_test",
  title: "Testpassage",
  excerpt: "Moms på representation.",
  source: "Skatteverket",
  url: "https://example.test/moms",
  score: 0.91,
};

test("configureKnowledgeRetrieval with null wiring yields keyword mode", async () => {
  configureKnowledgeRetrieval({ client: null, aiRuntime: null });
  const result = await queryKnowledge("moms");
  assert.equal(result.mode, "keyword");
  assert.ok(result.passages.length > 0);
});

test("queryKnowledge honors an explicit vector retriever", async () => {
  configureKnowledgeRetrieval({ client: null, aiRuntime: null });
  const retriever: VectorKnowledgeRetriever = {
    embedQuery: async () => [0.1, 0.2, 0.3],
    search: async () => [fakePassage],
  };
  const result = await queryKnowledge("moms", retriever);
  assert.equal(result.mode, "vector");
  assert.deepEqual(result.passages, [fakePassage]);
});

test("queryKnowledge falls back to keyword when vector search throws", async () => {
  configureKnowledgeRetrieval({ client: null, aiRuntime: null });
  const retriever: VectorKnowledgeRetriever = {
    embedQuery: async () => [0.1],
    search: async () => {
      throw new Error("pgvector down");
    },
  };
  const result = await queryKnowledge("moms", retriever);
  assert.equal(result.mode, "keyword");
  assert.ok(result.passages.length > 0);
});

test("queryKnowledge falls back to keyword when vector returns empty", async () => {
  configureKnowledgeRetrieval({ client: null, aiRuntime: null });
  const retriever: VectorKnowledgeRetriever = {
    embedQuery: async () => [0.1],
    search: async () => [],
  };
  const result = await queryKnowledge("moms", retriever);
  assert.equal(result.mode, "keyword");
  assert.ok(result.passages.length > 0);
});

test("queryKnowledge(null) forces keyword even after prior vector wiring", async () => {
  configureKnowledgeRetrieval({ client: null, aiRuntime: null });
  const result = await queryKnowledge("moms", null);
  assert.equal(result.mode, "keyword");
});
