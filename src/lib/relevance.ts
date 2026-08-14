// Personal relevance is deliberately separate from Growth Score. It only explains
// how a verified company/role relates to the active search profile.

import type { Company, FundingStage, JobPosting, SearchProfile, SearchRelevance, TeamSizeBand } from "../types.ts";

export interface CompanyFitFacts {
  fundingStage: FundingStage;
  tags: string[];
  teamSize?: TeamSizeBand;
  equityMentioned: boolean;
}

export type RelevanceResult = SearchRelevance;

export function companyFitFacts(company: Company, job?: JobPosting): CompanyFitFacts {
  const text = [company.category, company.description, ...(company.searchFacts?.businessModelTags ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  return {
    fundingStage: company.latestFunding?.stage ?? "unknown",
    tags: text ? [text] : [],
    // Employee size is not inferred from funding or open-role count.
    teamSize: company.searchFacts?.teamSize,
    equityMentioned: Boolean(company.searchFacts?.equityMentioned) || /\bequity\b|\boptions?\b/.test(job?.descriptionText ?? ""),
  };
}

function hasTheme(tags: string[], values: string[]): boolean {
  return values.some((value) => tags.some((tag) => tag.includes(value.toLowerCase())));
}

export function evaluateRelevance(
  company: Company,
  profile: SearchProfile,
  job?: JobPosting,
): RelevanceResult {
  const facts = companyFitFacts(company, job);
  const reasons: string[] = [];
  let score = 50;

  if (profile.excludedCompanyDomains.includes(company.domain)) {
    return { included: false, score: 0, label: "outside-criteria", reasons: ["company is on your avoid list"] };
  }

  if (profile.preferredStages.length) {
    const known = facts.fundingStage !== "unknown";
    const matched = profile.preferredStages.includes(facts.fundingStage);
    if (profile.stagePreferenceStrength === "required" && !matched) {
      return {
        included: false,
        score: 0,
        label: "outside-criteria",
        reasons: [known ? `outside required stage (${facts.fundingStage})` : "required company stage is unknown"],
      };
    }
    if (matched) { score += 20; reasons.push(`matches ${facts.fundingStage.replaceAll("-", " ")} stage preference`); }
    else reasons.push(known ? `outside preferred stage (${facts.fundingStage})` : "company stage is unknown");
  }

  const themes = [...profile.includedSectors, ...profile.businessModelThemes];
  if (themes.length) {
    const matched = hasTheme(facts.tags, themes);
    if (profile.includedSectors.length && profile.sectorPreferenceStrength === "required" && !matched) {
      return { included: false, score: 0, label: "outside-criteria", reasons: [facts.tags.length ? "outside required sector" : "company sector is unknown"] };
    }
    if (matched) { score += 15; reasons.push("matches your sector or business-model theme"); }
    else reasons.push(facts.tags.length ? "outside preferred sector/theme" : "company sector/theme is unknown");
  }

  if (profile.preferredTeamSizes.length) {
    if (facts.teamSize && profile.preferredTeamSizes.includes(facts.teamSize)) {
      score += 10;
      reasons.push(`matches ${facts.teamSize} team-size preference`);
    } else if (profile.teamSizePreferenceStrength === "required") {
      return { included: false, score: 0, label: "outside-criteria", reasons: ["required team size is unknown"] };
    } else reasons.push("team size is unknown");
  }

  if (profile.equityPriority !== "not-a-factor") {
    if (facts.equityMentioned) { score += 5; reasons.push("posting mentions equity"); }
    else reasons.push(profile.equityPriority === "must-discuss" ? "equity should be discussed" : "equity is not verified");
  }

  if (job && profile.customTitlePhrases.some((phrase) => job.title.toLowerCase().includes(phrase.toLowerCase()))) {
    score += 15;
    reasons.unshift("matches a custom title phrase");
  }

  const label: RelevanceResult["label"] = score >= 75 ? "strong" : score > 50 ? "match" : reasons.length ? "explore" : "match";
  return { included: true, score, label, reasons: reasons.length ? reasons : ["matches your broad search"] };
}
