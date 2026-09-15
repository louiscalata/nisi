import Foundation

// A closed embedded reference catalog, not a dynamic plugin loader or admission authority.
// Source-owned pins are selected separately from offered bytes. No path/name/hash selects code.
struct ReferenceArtifactPlugin: Sendable {
    enum Selection: Sendable { case artifactProfileV1 }
    enum Component: String, CaseIterable, Sendable {
        case manifest, operatorDescriptor = "operator", weights, schema, preprocessing, dependencies
    }
    enum Failure: Error, Equatable, Sendable {
        case missingObject(Component), objectByteCount(Component), objectDigestMismatch(Component)
        case unsupportedImplementation
    }
    typealias Objects = [Component: Data]
    private static let pins: [(Component, Int, String)] = [
        (.operatorDescriptor, 148, "e1cc917069a7ba179f1f09f8bcd3934fcdd757b62a4cd8aa0a4b0f0a000db73e"),
        (.weights, 160, "2da8d4ae0621cf2fecfd789fead12f6a55a735823495d7c9ef3a85b3da6e3e11"),
        (.schema, 299, "7190d617696607ef9d185c9b4df1d65d247d94e368f202cd95c0df86d91aa2da"),
        (.preprocessing, 357, "41dac7b8c1ecb53f6512e064fc76000e13705ffcb44285ee7dc4dcb4aaa76ff4"),
        (.dependencies, 118, "28008fb5bfed82b46edc1fac7503451c5c8651c5546d156279be97de31b6cdbe"),
        (.manifest, 465, "c4598e88e9e0a2ce52345bd4ff063359af603e2cbf275570f2453d5aca29fa5f")
    ]

    let packageSHA256: String
    let featureSchemaSHA256: String
    let preprocessingSHA256: String
    let model: ReferenceMLP

    private init(model: ReferenceMLP) {
        self.model = model
        packageSHA256 = "c4598e88e9e0a2ce52345bd4ff063359af603e2cbf275570f2453d5aca29fa5f"
        featureSchemaSHA256 = "7190d617696607ef9d185c9b4df1d65d247d94e368f202cd95c0df86d91aa2da"
        preprocessingSHA256 = "41dac7b8c1ecb53f6512e064fc76000e13705ffcb44285ee7dc4dcb4aaa76ff4"
    }

    static var embeddedObjects: Objects {
        var weights = Data()
        for _ in 0..<2 {
            for row in 0..<4 {
                for column in 0..<4 {
                    let bits: UInt32 = row == column ? 0x3f800000 : 0
                    for shift in [0, 8, 16, 24] { weights.append(UInt8(truncatingIfNeeded: bits >> shift)) }
                }
            }
            weights.append(contentsOf: repeatElement(UInt8(0), count: 16))
        }
        return [
            .operatorDescriptor: Data("veritas/reference-operator/v1\nkind=dense-relu-dense-v1\nshape=4:4:4\ndtype=f32-le\nweight_order=w1,b1,w2,b2\nnumeric=veritas-bn02-reference-mlp-prep-v1\n".utf8),
            .schema: Data("veritas/artifact-feature-schema/v1\n0=snapshot.rawByteCount;unit=bytes;max=1048576\n1=profile.sanitizedRequiredSectionCount;unit=entries;max=64\n2=profile.allowedAdvisoryDimensionCount;unit=entries;max=4\n3=profile.clampedMaximumAdvisoryDimensions;unit=entries;max=4\ndtype=f32-le;width=4;missing=refuse\n".utf8),
            .preprocessing: Data("veritas/artifact-preprocessing/v1\nsource=owned-snapshot-and-resource-admitted-check-profile\nencoding=utf8;byte_count=1..1048576\nnormalization=divide-by-1048576,64,4,4\nprofile_semantics=veritas-check-profile-rules-v1\norder=declared-schema-order;rounding=binary32\noutcomes=excluded;display_name=excluded\nevents=caller-bound-metadata-not-authenticated-history\n".utf8),
            .dependencies: Data("veritas/reference-dependencies/v1\nkernel=veritas-bn02-reference-mlp-prep-v1\nadapter=artifact-profile-v1\nexternal=none\n".utf8),
            .weights: weights,
            .manifest: Data("veritas/embedded-reference-package/v1\nprofile=artifact-profile-v1\nrevision=1\nshape=4:4:4\noperator=e1cc917069a7ba179f1f09f8bcd3934fcdd757b62a4cd8aa0a4b0f0a000db73e\nweights=2da8d4ae0621cf2fecfd789fead12f6a55a735823495d7c9ef3a85b3da6e3e11\nschema=7190d617696607ef9d185c9b4df1d65d247d94e368f202cd95c0df86d91aa2da\npreprocessing=41dac7b8c1ecb53f6512e064fc76000e13705ffcb44285ee7dc4dcb4aaa76ff4\ndependencies=28008fb5bfed82b46edc1fac7503451c5c8651c5546d156279be97de31b6cdbe\n".utf8)
        ]
    }

    static func resolve(_ selection: Selection, objects: Objects) throws -> Self {
        switch selection { case .artifactProfileV1: break }
        // Labels constrain this implementation profile, but do not attest its executing binary.
        guard ReferenceMLP.profile == "veritas-bn02-reference-mlp-prep-v1",
              CheckProfile.rulesetVersion == "veritas-check-profile-rules-v1"
        else { throw Failure.unsupportedImplementation }
        // Check ALL exact lengths before copying/hashing any offered component.
        for (component, count, _) in pins {
            guard let raw = objects[component] else { throw Failure.missingObject(component) }
            guard raw.count == count else { throw Failure.objectByteCount(component) }
        }
        var owned: Objects = [:]
        for (component, _, expected) in pins {
            guard let raw = objects[component] else { throw Failure.missingObject(component) }
            // Caller may not race external storage mutation against this synchronous copy.
            let bytes = Data([UInt8](raw))
            guard ArtifactSnapshot.digest(bytes) == expected else { throw Failure.objectDigestMismatch(component) }
            owned[component] = bytes
        }
        guard let weights = owned[.weights] else { throw Failure.missingObject(.weights) }
        let model = try ReferenceMLP(shape: .init(input: 4, hidden: 4, output: 4),
            weightBytes: weights, expectedWeightsSHA256: "2da8d4ae0621cf2fecfd789fead12f6a55a735823495d7c9ef3a85b3da6e3e11")
        return Self(model: model)
    }
}
