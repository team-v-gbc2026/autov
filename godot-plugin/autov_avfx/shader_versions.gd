# Generated from trusted autoV source; never compile archive shader text.
extends RefCounted
const EXPECTED = {
  "particle": {
    "vertex": "a031010eed1957f7422b613c9d3ba8254be22d61a463d2a7a8fd71f3b3cd8082",
    "fragment": "df5a63375111d8ec5b234a9ad2f38fbcf10b21e8ba742dbcf77a2304880d26eb"
  },
  "subParticle": {
    "vertex": "d285304d95f1d53b8e57f8c72263e2f2421103e6ba5f9b34d37db26ce98b0a89",
    "fragment": "df5a63375111d8ec5b234a9ad2f38fbcf10b21e8ba742dbcf77a2304880d26eb"
  },
  "trail": {
    "vertex": "ef9dc3109d1369c96403fb4a19a5a2284f418f727412f7adcb9c0284d99ff8a9",
    "fragment": "26b9025fedf8b6d6007e5ebfc09a2e119cce7d5b8904ecda2cac32393d3bc504"
  },
  "subTrail": {
    "vertex": "6f9eaacb954791d1b92b85094b8c26e8537d0a6f0de68fa6eb1774d20303fd5e",
    "fragment": "26b9025fedf8b6d6007e5ebfc09a2e119cce7d5b8904ecda2cac32393d3bc504"
  },
  "strip": {
    "vertex": "6cb3de2efc19152e54db40f600be80502612413036353d507f7f56264ce8a589",
    "fragment": "16acc7ccdda57d879c2f6749cdb824d78490446cd0b4794db53bdf03a1beb596"
  },
  "sliver": {
    "vertex": "1e56f94d00fe500c71974e4d5b347f117897789e7dfaf43b296917cd06fdf0e2",
    "fragment": "7e6f14558a2f4806115fafcf1b81f2c63d8b05ff9081ca77b99b38588d7e4609"
  },
  "surface": {
    "vertex": "1f9030d68f3719121fac50a8c5cafeeb7bd0efe9fad36793c0afa0e169c99bca",
    "fragment": "31a2e693e02db0d3583d1ab97007fc4d9ced67bee74e4a8cadd4b8455f887efe"
  },
  "blob": {
    "vertex": "c591c009e54eacafd77848b7a2615927c3b0ed94a929b49e1969815a93c4840a",
    "fragment": "4e9934038aa0ab120dd2f5f651c12f669c854295d679cef1ca9b82edecf8405d"
  },
  "crystal": {
    "vertex": "a0af02d93bfb4ab3dbbb205403275d15b7e16e79cc082e74b0e2c6dce51fe040",
    "fragment": "256e15d4ba1d3c6d2fea1038e890898269856670b7d7011652537ab18873acf6"
  },
  "splash": {
    "vertex": "0550e72f5314e8e0e37c1f297deecd61e900f156e8708dbd12d223d9a37afca2",
    "fragment": "3b4a91765d94c4a14da8287cbe0a49c23474c28b154eac53585b90564ab6b53c"
  },
  "ribbon": {
    "vertex": "1a568b9fcba1fb0e75bd3cfc9405dafd1ef18e46cd6d6e898c1c49bbcaa48bdd",
    "fragment": "9ba9ac2d44b44f996aea9920d6575391ca648549bab3237bca8b0543e23cf4d7"
  },
  "wireBurst": {
    "vertex": "41bff9658a30882c465fd8ce683e74acd8838b2f93e15cc08e3200b4080d8608",
    "fragment": "14bb527cd4749801f699fc684c9eb49970fc023afcb5c51dd4b79867715952f3"
  },
  "arc": {
    "vertex": "c365bf12f4957a86caf30ecad20786158ce71b1f9a6407b3575d8f44e0af3695",
    "fragment": "5152744a26018b798d44b1733c553fdf9b21cb51abb32b10f7851343a409b3ac"
  },
  "streak": {
    "vertex": "84646bbad5c6d65feff2dc9e2e043485fc351670c5996c31b1d2c6e978cf591b",
    "fragment": "65aea4e10d2bd4771291c65f5560435e14f06c9ac51d0493bb1dcf2501a100d1"
  },
  "sheet": {
    "vertex": "0bfa77ad1bce74401e9948823f41b81c0396388e724e9a3cb821cc3d40ad50ec",
    "fragment": "2d22e4e94a40b928c3fb4b114904c9eb17758c38f0b827bbc7e7e94b6fb3fac8"
  },
  "crescent": {
    "vertex": "16cb57b7dbdb7415a9d906c3261979c026354097938e967e5a9136b2c4f06b1b",
    "fragment": "021ba9908a3b3d8dc3cab4a9a9dffcd14dd8c4f27af0092b1b3e17564c6df8fd"
  },
  "lick": {
    "vertex": "4c6051aa9b9084516c72a286fa6e6fa24b1f8c4e0545e66c03486b2441a1e4f6",
    "fragment": "233a55975b3ce13c30e855c7d46abb2edce6734e16eb04c97e547e5cf6511199"
  }
}
const ATTRIBUTES = {
  "particle": [
    {
      "name": "aSeed",
      "type": "vec4"
    },
    {
      "name": "aExtra",
      "type": "vec4"
    },
    {
      "name": "aExtra2",
      "type": "vec4"
    },
    {
      "name": "aIndex",
      "type": "float"
    },
    {
      "name": "aSrcPos",
      "type": "vec3"
    },
    {
      "name": "aSrcDir",
      "type": "vec3"
    },
    {
      "name": "aEvent",
      "type": "vec4"
    }
  ],
  "subParticle": [
    {
      "name": "aSeed",
      "type": "vec4"
    },
    {
      "name": "aExtra",
      "type": "vec4"
    },
    {
      "name": "aExtra2",
      "type": "vec4"
    },
    {
      "name": "aIndex",
      "type": "float"
    },
    {
      "name": "aPSeed",
      "type": "vec4"
    },
    {
      "name": "aPExtra",
      "type": "vec4"
    },
    {
      "name": "aPExtra2",
      "type": "vec4"
    },
    {
      "name": "aSrcPos",
      "type": "vec3"
    },
    {
      "name": "aSrcDir",
      "type": "vec3"
    },
    {
      "name": "aEvent",
      "type": "vec4"
    }
  ],
  "trail": [
    {
      "name": "aSeed",
      "type": "vec4"
    },
    {
      "name": "aExtra",
      "type": "vec4"
    },
    {
      "name": "aExtra2",
      "type": "vec4"
    },
    {
      "name": "aIndex",
      "type": "float"
    },
    {
      "name": "aSrcPos",
      "type": "vec3"
    },
    {
      "name": "aSrcDir",
      "type": "vec3"
    },
    {
      "name": "aEvent",
      "type": "vec4"
    }
  ],
  "subTrail": [
    {
      "name": "aSeed",
      "type": "vec4"
    },
    {
      "name": "aExtra",
      "type": "vec4"
    },
    {
      "name": "aExtra2",
      "type": "vec4"
    },
    {
      "name": "aIndex",
      "type": "float"
    },
    {
      "name": "aPSeed",
      "type": "vec4"
    },
    {
      "name": "aPExtra",
      "type": "vec4"
    },
    {
      "name": "aPExtra2",
      "type": "vec4"
    },
    {
      "name": "aSrcPos",
      "type": "vec3"
    },
    {
      "name": "aSrcDir",
      "type": "vec3"
    },
    {
      "name": "aEvent",
      "type": "vec4"
    }
  ],
  "strip": [
    {
      "name": "aSeed",
      "type": "vec4"
    },
    {
      "name": "aExtra",
      "type": "vec4"
    },
    {
      "name": "aExtra2",
      "type": "vec4"
    },
    {
      "name": "aIndex",
      "type": "float"
    },
    {
      "name": "aSrcPos",
      "type": "vec3"
    },
    {
      "name": "aSrcDir",
      "type": "vec3"
    },
    {
      "name": "aEvent",
      "type": "vec4"
    }
  ],
  "sliver": [
    {
      "name": "aSeed",
      "type": "vec4"
    },
    {
      "name": "aExtra",
      "type": "vec4"
    },
    {
      "name": "aExtra2",
      "type": "vec4"
    },
    {
      "name": "aIndex",
      "type": "float"
    },
    {
      "name": "aSrcPos",
      "type": "vec3"
    },
    {
      "name": "aSrcDir",
      "type": "vec3"
    },
    {
      "name": "aEvent",
      "type": "vec4"
    },
    {
      "name": "aSub",
      "type": "float"
    }
  ],
  "surface": [],
  "blob": [
    {
      "name": "aLobeA",
      "type": "vec4"
    },
    {
      "name": "aLobeB",
      "type": "vec4"
    },
    {
      "name": "aLobeC",
      "type": "vec4"
    },
    {
      "name": "aLobeP",
      "type": "vec4"
    }
  ],
  "crystal": [
    {
      "name": "aDir",
      "type": "vec3"
    },
    {
      "name": "aOrg",
      "type": "vec3"
    },
    {
      "name": "aLen",
      "type": "float"
    },
    {
      "name": "aWid",
      "type": "float"
    },
    {
      "name": "aT0",
      "type": "float"
    },
    {
      "name": "aSeed",
      "type": "float"
    },
    {
      "name": "aAlong",
      "type": "float"
    }
  ],
  "splash": [],
  "ribbon": [],
  "wireBurst": [
    {
      "name": "aDir",
      "type": "vec3"
    },
    {
      "name": "aSeed",
      "type": "float"
    },
    {
      "name": "aKind",
      "type": "float"
    }
  ],
  "arc": [
    {
      "name": "aSeed",
      "type": "float"
    }
  ],
  "streak": [
    {
      "name": "aSeed",
      "type": "float"
    }
  ],
  "sheet": [
    {
      "name": "aSheetSeed",
      "type": "float"
    },
    {
      "name": "aSheetAge",
      "type": "float"
    }
  ],
  "crescent": [
    {
      "name": "aS",
      "type": "float"
    },
    {
      "name": "aQ",
      "type": "float"
    }
  ],
  "lick": [
    {
      "name": "aSeed",
      "type": "float"
    },
    {
      "name": "aSide",
      "type": "float"
    }
  ]
}
