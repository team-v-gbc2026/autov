using UnrealBuildTool;
public class AutoVEditor : ModuleRules {
    public AutoVEditor(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new [] { "Core", "CoreUObject", "Engine", "UnrealEd", "AutoVRuntime" });
        PrivateDependencyModuleNames.AddRange(new [] { "Json", "AssetRegistry" });
    }
}
