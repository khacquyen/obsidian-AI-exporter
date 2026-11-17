import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runE2EPipeline,
  assertExtractionSuccess,
  assertSourcePlatform,
  assertMessageStructure,
  assertFrontmatterFields,
  assertCalloutFormat,
} from './helpers';
import { clearFixture, resetLocation } from '../../fixtures/dom-helpers';

describe('Gemini E2E Extraction', () => {
  beforeEach(() => {
    clearFixture();
  });

  afterEach(() => {
    clearFixture();
    resetLocation();
  });

  describe('Chat - Simple Conversation', () => {
    const FIXTURE = 'chat-simple';
    const CONVERSATION_ID = 'e2e-gemini-chat-001';

    it('should extract conversation with valid structure', async () => {
      const result = await runE2EPipeline('gemini', FIXTURE, CONVERSATION_ID);

      // Type Guard: result narrows to E2EPipelineSuccessResult
      assertExtractionSuccess(result);

      // Can use without non-null assertion
      assertSourcePlatform(result.conversationData, 'gemini');
      assertMessageStructure(result.conversationData, { minCount: 2 });
      assertFrontmatterFields(result.obsidianNote);
      assertCalloutFormat(result.finalMarkdown, 'gemini');
    });

    it('should generate correct markdown output', async () => {
      const result = await runE2EPipeline('gemini', FIXTURE, CONVERSATION_ID);
      assertExtractionSuccess(result);

      expect(result.finalMarkdown).toMatchSnapshot();
    });

    it('should have correct message count in metadata', async () => {
      const result = await runE2EPipeline('gemini', FIXTURE, CONVERSATION_ID);
      assertExtractionSuccess(result);

      expect(result.obsidianNote.frontmatter.message_count).toBe(
        result.conversationData.messages.length
      );
    });
  });

  // Fork: the panel-only Deep Research export is gone for Gemini; the
  // deep-research fixture is exercised embedded in a conversation by
  // test/extractors/gemini-deep-research.test.ts.
});
