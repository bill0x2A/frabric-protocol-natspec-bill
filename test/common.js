const { ethers, waffle } = require("hardhat");
const { assert, expect } = require("chai");

module.exports = {
  WhitelistStatus: {
    Null: 0,
    Removed: 1,
    Whitelisted: 2,
    KYC: 3
  },

  OrderType: {
    Null: 0,
    Buy: 1,
    Sell: 2,
    counter: type => (type % 2) + 1
  },

  ProposalState: {
    Null: 0,
    Active: 1,
    Queued: 2,
    Executed: 3,
    Cancelled: 4
  },

  VoteDirection: {
    Abstain: 0,
    Yes: 1,
    No: 2
  },

  CommonProposalType: {
    Paper: 256,
    Upgrade: 257,
    TokenAction: 258,
    ParticipantRemoval: 259
  },

  FrabricProposalType: {
    Participant: 0,
    BondRemoval: 1,
    Thread: 2,
    ThreadProposal: 3
  },

  ParticipantType: {
    Null: 0,
    Removed: 1,
    Genesis: 2,
    KYC: 3,
    Governor: 4,
    Voucher: 5,
    Individual: 6,
    Corporation: 7
  },

  GovernorStatus: {
    Null: 0,
    Active: 1,
    Removed: 2
  },

  ThreadProposalType: {
    DescriptorChange: 0,
    FrabricChange: 1,
    GovernorChange: 2,
    EcosystemLeaveWithUpgrades: 3,
    Dissolution: 4
  },

  snapshot: () => waffle.provider.send("evm_snapshot", []),
  revert: (id) => waffle.provider.send("evm_revert", [id]),
  impermanent: test => async () => {
    const id = await module.exports.snapshot();
    await test();
    await module.exports.revert(id);
  },

  mine: async (blocks) => {
    for (let i = 0; i < blocks; i++) {
      await waffle.provider.send(
        "evm_mine",
        [(await waffle.provider.getBlock("latest")).timestamp + 13]
      );
    }
  },
  increaseTime: (time) => waffle.provider.send("evm_increaseTime", [time]),

  propose: async (dao, proposal, supermajority, args, insert) => {
    let ProposalType;
    if (module.exports.CommonProposalType.hasOwnProperty(proposal)) {
      ProposalType = module.exports.CommonProposalType;
    } else if ((await dao.contractName()) === ethers.utils.id("Frabric")) {
      ProposalType = module.exports.FrabricProposalType;
    } else {
      ProposalType = module.exports.ThreadProposalType;
    }

    const id = await dao.nextProposalID();

    const info = ethers.utils.id(proposal);
    // Don't chain due to https://github.com/TrueFiEng/Waffle/issues/595 and
    // https://github.com/TrueFiEng/Waffle/issues/647
    // withArgs is unstable to the point these tests might be finely reviewed by
    // a human and it's honestly unsafe to call them sufficient until either
    // waffle corrects it OR withArgs is completely replaced
    // TODO
    const tx = await dao["propose" + proposal](...args, info);
    await expect(tx).to.emit(dao, "Proposal").withArgs(
      id,
      ProposalType[proposal],
      dao.signer.address,
      supermajority,
      info
    );
    await expect(tx).to.emit(dao, "ProposalStateChange").withArgs(id, module.exports.ProposalState.Active);
    expect(await dao.nextProposalID()).to.equal(id.add(1));
    expect(await dao.supermajorityRequired(id)).to.equal(supermajority);
    expect(await dao.voteBlock(id)).to.equal((await waffle.provider.getBlock("latest")).number - 1);

    if (
      (typeof(args[args.length - 1]) === "object") &&
      (!args[args.length - 1].hasOwnProperty("_isBigNumber"))
    ) {
      args.pop();
    }

    if (proposal === "ParticipantRemoval") {
      args.pop();
    }

    if (typeof(insert) !== "undefined") {
      args.splice(insert, 0, dao.signer.address);
    }

    if (proposal !== "Paper") {
      await expect(tx).to.emit(dao, proposal + "Proposal").withArgs(id, ...args);
    }

    return { id, tx };
  },

  queueAndComplete: async (dao, id, data) => {
    if (!data) {
      data = "0x";
    }

    // Advance the clock by the voting period (+ 1 second)
    module.exports.increaseTime(parseInt(await dao.votingPeriod()) + 1);

    // Queue the proposal
    await expect(
      await dao.queueProposal(id)
    ).to.emit(dao, "ProposalStateChange").withArgs(id, module.exports.ProposalState.Queued);

    // Advance the clock 48 hours
    module.exports.increaseTime(2 * 24 * 60 * 60 + 1);

    // Complete it
    const tx = await dao.completeProposal(id, data);
    await expect(tx).to.emit(dao, "ProposalStateChange").withArgs(id, module.exports.ProposalState.Executed);
    assert(await dao.passed(id));
    return tx;
  },

  proposal: async (dao, proposal, supermajority, args, config) => {
    config = config ? config : {}; // Allow accessing members even if it's undefined
    const { id } = await module.exports.propose(dao, proposal, supermajority, args, config.insert);
    if (config.voter) {
      await expect(
        await dao.connect(config.voter).vote([id], [ethers.constants.MaxUint256.mask(111)])
      ).to.emit(dao, "Vote");
    }

    let data = null;
    if (typeof(config.order) !== "undefined") {
      data = (new ethers.utils.AbiCoder()).encode(["uint256"], [config.order]);
    }
    return { id, tx: await module.exports.queueAndComplete(dao, id, data) };
  }
}
