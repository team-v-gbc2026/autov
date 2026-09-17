using UnrealBuildTool;
public class AutoVAVFXEditor : ModuleRules
{
    public AutoVAVFXEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PrivateDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "AutoVAVFX", "UnrealEd", "Json", "ImageWrapper", "AssetTools" });
    }
}
