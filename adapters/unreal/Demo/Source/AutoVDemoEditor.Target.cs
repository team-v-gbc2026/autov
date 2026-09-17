using UnrealBuildTool;
public class AutoVDemoEditorTarget : TargetRules {
    public AutoVDemoEditorTarget(TargetInfo Target) : base(Target) { Type=TargetType.Editor; DefaultBuildSettings=BuildSettingsVersion.Latest; IncludeOrderVersion=EngineIncludeOrderVersion.Latest; ExtraModuleNames.Add("AutoVDemo"); }
}
