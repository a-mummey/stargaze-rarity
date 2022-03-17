import { QueryContract } from "../cosmwasm/sg721";
import { defaultConfig } from "../config";
import asyncPool = require("tiny-async-pool");
import { fetchMetadata } from "./fetch";

type TraitValue = string | number | boolean | null;

interface Trait {
  trait_type: string;
  value: TraitValue;
}

export const downloadMetadata = async (sg721Contract: string) => {
  // get contract info
  const config = defaultConfig();
  const queryContract = await QueryContract.init(config)
  const contractInfo = await queryContract.contractInfo(sg721Contract)

  //assume it's sequential, without gaps in token ids

  const cid = contractInfo.baseUri.split("/").pop()

  const allTraits: { [key: string]: Map<TraitValue, number> } = {};
  const tokenTraits = new Map<string, Trait[]>();
  const gateways = [config.pinataGatewayBaseUrl, config.ipfsGatewayBaseUrl]
  await asyncPool(15, [...Array(contractInfo.totalSupply).keys()], async (i: number) => {
    i = i + 1;
    let metadata = await fetchMetadata(gateways, cid, i.toString())
    if (!metadata) {
      throw new Error(`Failed to fetch token metadata ${i}`)
    }
    let traits: Trait[] = [];
    if (Array.isArray(metadata.traits)) {
      traits = metadata.traits as Trait[]
    }

    // save to db here?

    // count trait frequency
    for (let trait of traits) {
      if (!allTraits[trait.trait_type]) {
        allTraits[trait.trait_type] = new Map<TraitValue, number>();
      }
      const current = allTraits[trait.trait_type].get(trait.value) || 0;
      allTraits[trait.trait_type].set(trait.value, current + 1)
    }
    tokenTraits.set(i.toString(), traits)
  })

  const numTokens = tokenTraits.size;
  const allTraitNames = Object.keys(allTraits)
  // counts for empty traits
  for (let tokenId of tokenTraits.keys()) {
    const thisTokenTraits = tokenTraits.get(tokenId)
    for (let traitName of allTraitNames) {
      const trait = thisTokenTraits.find(t => t.trait_type === traitName)
      if (trait === undefined) {
        const current = allTraits[traitName].get(null) || 0;
        allTraits[traitName].set(null, current + 1)
      }
    }
  }
  // now calculate scores
  const scores = new Map<string, number>();
  for (let tokenId of tokenTraits.keys()) {
    const thisTokenTraits = tokenTraits.get(tokenId)
    let score = 0;
    for (let traitName of allTraitNames) {
      const trait = thisTokenTraits.find(t => t.trait_type === traitName)
      const traitvalue = trait?.value || null;
      const s = 1 / (allTraits[traitName].get(traitvalue) / numTokens)
      score += s;
    }
    scores.set(tokenId, score)
  }

  // analysis on traits
  console.log('done')
  return { allTraits, tokenTraits, scores, numTokens }
}