/**
 * Citation tracking utility for managing footnotes and references in LLM responses
 */

export interface Citation {
    title: string;
    url: string;
    citedText?: string;
}

export interface CitationTracker {
    citations: Map<string, Citation>;
}

/**
 * Create a new citation tracker
 */
export function createCitationTracker(): CitationTracker {
    return {
        citations: new Map(),
    };
}

/**
 * Format citation as a footnote and return a reference marker
 */
export function formatCitation(
    tracker: CitationTracker,
    citation: Citation
): string {
    if (!tracker.citations.has(citation.url)) {
        tracker.citations.set(citation.url, citation);
    }
    return ` [${Array.from(tracker.citations.keys()).indexOf(citation.url) + 1}]`;
}

/**
 * Generate formatted footnotes from citation tracker
 */
export function generateFootnotes(tracker: CitationTracker): string {
    if (tracker.citations.size === 0) return '';

    const footnotes = Array.from(tracker.citations.values())
        .map((citation, i) => `[${i + 1}] ${citation.title} – ${citation.url}`)
        .join('\n');

    return '\n\nReferences:\n' + footnotes;
}